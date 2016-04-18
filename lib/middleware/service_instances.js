/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015, 2016. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
"use strict";

var
 checkOtcApiAuth = require("./check-otc-api-auth"),
 express = require("express"),
 log4js = require("log4js"),
 nanoDocUpdater = require("nano-doc-updater"),
 nconf = require("nconf"),
 pagerDutyUtils = require("./pagerduty-utils"),
 request = require("request"),
 tiamUtil = require("../util/tiam-util"),
 _ = require("underscore")
;

var logger = log4js.getLogger("pagerduty-broker"),
 	logBasePath = "lib.middleware.service_instances";

var r = express.Router();
r
.use(checkOtcApiAuth)
.put("/:sid", createOrUpdateServiceInstance)
.put("/:sid/toolchains/:tid", bindServiceInstanceToToolchain)
.patch("/:sid", patchServiceInstance)
.delete("/:sid", unbindServiceInstance)
.delete("/:sid/toolchains", unbindServiceInstanceFromAllToolchains)
.delete("/:sid/toolchains/:tid", unbindServiceInstanceFromToolchain)
;

module.exports = r;

/**
*	Checks if the service instance already exists. If one does,
*	and the parameters (i.e. list title) needs an update, then the value
*	is updated. If the parameters are not updated, a check is done to
*	update the remaining parameters, e.g. toolchains associated with
*	the service instance. Otherwise, no instance exists so
*	a list is created along with an instance.
*
*	Note: If a list title is changed outside the instance in the
*	service itself, then the parameters and title can be out of sync.
**/
function createOrUpdateServiceInstance (req, res) {
	var logPrefix = "[" + logBasePath + ".createOrUpdateServiceInstance] ";
	var db = req.servicesDb,
		serviceInstanceId = req.params.sid,
		parametersData = req.body.parameters,
		organizationId = req.body.organization_guid,
		serviceCredentials = req.body.service_credentials;

	logger.info(logPrefix + "Provisionning the service instance with ID: " + serviceInstanceId
			+ " using parameters:" + JSON.stringify(parametersData));
	
	// req.body (from external request) is not the same as body (response from Cloudant dB).
	if(!req.body.service_id) {
		return res.status(400).json({ "description": "Error: service_id is a required parameter." });
	}
	if(!organizationId) {
		return res.status(400).json({ "description": "Error: organization_guid is a required parameter." });
	}
	
	db.get(serviceInstanceId, null, function(err, body) {
		if(err && err.statusCode !== 404) {
			logger.error(logPrefix + "Retrieving the service instance with" +
				" ID: " + serviceInstanceId + " failed with the following" +
				" error: " + err.toString());

			res.status(500).json({ "description": err.toString() });
			return;
		} else if(err && err.statusCode === 404) {
			/**
			*	The service instance does not exist, create
			*	one
			**/
			if(!serviceCredentials) {
				return res.status(400).json({ "description": "Error: service_credentials is a required parameter." });
			}
			return createOrUpdateServiceInstance_(res, req, db, serviceInstanceId, organizationId, serviceCredentials, parametersData, false/*not patching*/)
		} else {
			/**
			*	The service instance exists but the parameters needs an update.
			**/
			if(!serviceCredentials) {
				// ensure serviceCredentials is there
				serviceCredentials = body.service_credentials;
			}
			if(!serviceCredentials) {
				return res.status(400).json({ "description": "Error: service_credentials is a required parameter." });
			}
			return createOrUpdateServiceInstance_(res, req, db, serviceInstanceId, organizationId, serviceCredentials, parametersData, false/*not patching*/)
		}
	});
}

function createOrUpdateServiceInstance_(res, req, db, serviceInstanceId, organizationId, serviceCredentials, parametersData, patching) {
	var logPrefix = "[" + logBasePath + ".createOrUpdateServiceInstance_] ";
	var account_id;
	var api_key;
	var service_name;
	var user_email;
	var user_phone;
	if (parametersData) {
		account_id = parametersData.account_id;
		api_key = parametersData.api_key;
		
		// backward compatibility
		if (!api_key)
			api_key = parametersData.api_token;
		
		service_name = parametersData.service_name;
		user_email = parametersData.user_email;
		user_phone= parametersData.user_phone;
	}
	var parameters = {};
	if (account_id && api_key) {
		var baseUrl = nconf.get("services:pagerduty");
		var httpsPrefix = "https://";
		var index = baseUrl.indexOf(httpsPrefix);
		if (index != 0) {
			return res.status(400).json({ "description": "Invalid pagerduty service: " + baseUrl + ", it should start with " + httpsPrefix});
		}
		var url = httpsPrefix + account_id + '.' + baseUrl.substring(httpsPrefix.length);
		var apiUrl = url + "/api/v1";
		pagerDutyUtils.getOrCreatePagerDutyService(res, apiUrl, api_key, account_id, service_name, user_email, user_phone, patching, function(err, service) {
			if (err)
				return;
			
			var dashboardUrl = url + service.service_url;
			parameters.label = service_name;
			parameters.service_id = service.id;
			parameters.service_key = service.service_key;
			
			parameters.account_id = account_id;
			parameters.api_key = api_key;
			parameters.service_name = service_name;
				
			if (!user_email && !user_phone) {
				// we're reusing an existing service, need to retrieve the user email and phone from this service
				return pagerDutyUtils.getEscalationPolicy(res, apiUrl, api_key, service.escalation_policy.id, function(err, escalationPolicy) {
					if (err)
						return;
					var userId = escalationPolicy.escalation_rules[0].targets[0].id;
					pagerDutyUtils.getUserInfo(res, apiUrl, api_key, userId, function(err, email, phone) {
						if (err)
							return;
						parameters.user_email = user_email ? user_email : email;
						parameters.user_phone = user_phone ? user_phone : phone;
						return doServiceUpdate(res, req, db, serviceInstanceId, serviceCredentials, parameters, service.id, organizationId, dashboardUrl);
					});
				});
			}
			parameters.user_email = user_email;
			parameters.user_phone = user_phone;
			return doServiceUpdate(res, req, db, serviceInstanceId, serviceCredentials, parameters, service.id, organizationId, dashboardUrl);
		});
	} else {
		// Creation of incomplete service instance
		return doServiceUpdate(res, req, db, serviceInstanceId, serviceCredentials, parameters, "n/a", organizationId, "https://www.pagerduty.com");
	}	
}

/**
*	Handles updating the service instance with the new properties.
**/
function doServiceUpdate (res, req, db, serviceInstanceId, serviceCredentials, parametersData, instanceId, organizationId, dashboardUrl) {
	var logPrefix = "[" + logBasePath + ".doServiceUpdate] ";
	
	// paranoia start
	if (!parametersData.account_id) {
		logger.error(logPrefix + "Account id missing");
	}
	if (!parametersData.api_key) {
		logger.error(logPrefix + "API key missing");
	}
	if (!parametersData.service_name) {
		logger.error(logPrefix + "Service name missing");
	}
	if (!parametersData.user_email) {
		logger.error(logPrefix + "User email missing");
	}
	if (!parametersData.user_phone) {
		logger.error(logPrefix + "User phone missing");
	}
	// paranoia end

	logger.debug(logPrefix + "Updating db with serviceInstanceId=" + serviceInstanceId);
	return nanoDocUpdater()
		.db(db)
		.id(serviceInstanceId)
		.existingDoc(null)
		.newDoc(_.extend(
			{
				type: "service_instance",
				parameters: parametersData,
				instance_id: instanceId,
				dashboard_url: dashboardUrl,
				organization_guid: organizationId,
				service_credentials: serviceCredentials
			},
			{
				toolchain_ids: []
			}
		))
		.shouldUpdate(function (published, proposed) {
			return published.type !== proposed.type ||
				   published.parameters !== proposed.parameters ||
				   published.instance_id !== proposed.instance_id ||
				   published.dashboard_url !== proposed.dashboard_url ||
				   published.organization_guid !== proposed.organization_guid;
		})
		.update(function (err) {
				if (err) {
					logger.error(logPrefix + "Updating the service instance with" +
						" ID: " + serviceInstanceId + " and parameters: " + parametersData +
						" failed with the following error: " + err.toString());

		            if(err.statusCode === 404) {
		                return res.status(404).json({ "description": err.toString() });
		            }

					return res.status(500).json({ "description": err.toString() });
				}

				return res.json({
					instance_id: instanceId,
					dashboard_url: dashboardUrl,
					parameters: parametersData,
					organization_guid: organizationId
				});
			}
		);
}

/*
	Assumption:  A service instance may only be bound to one toolchain at a time.

	If this is not the case, we should replace toolchain_id in docs with toolchain_ids
	and do a merge (adding the toolchain_id to the list) instead of clobbering the
	whole doc here.
*/
function bindServiceInstanceToToolchain (req, res/*, next*/) {
	var logPrefix = "[" + logBasePath + ".bindServiceInstanceToToolchain] ";

	var db = req.servicesDb,
	serviceInstanceId = req.params.sid,
	toolchainId = req.params.tid,
	toolchainCredentials = req.body.toolchain_credentials;
	
	var updatedDocument;
	
	logger.info(logPrefix + "Binding the service instance with" +
			" ID: " + serviceInstanceId + " to toolchain ID: " + toolchainId);
	
	
	if (!toolchainCredentials) {
		return res.status(400).json({ "description": "Error: toolchain_credentials is a required parameter." });
	}

	return nanoDocUpdater()
	.db(db)
	.id(serviceInstanceId)
	.existingDoc(null)
	.newDoc(null)
	.shouldCreate(false)
	.shouldUpdate(function (published) {
		// only update if no binding for a given toolchain
		var result = _.find(published.toolchain_ids, function(obj) {
			if (obj.id === toolchainId) {
				return true;
			}
		});
		return result == undefined;
	})
	.merge(function (published) {
		published.toolchain_ids.push({id: toolchainId, credentials: toolchainCredentials});
		updatedDocument = published;
		return published;
	})
	.update(function (err, doc) {
		if (err) {
			logger.error(logPrefix + "Binding the service instance with" +
				" ID: " + serviceInstanceId + " to toolchain ID: " + toolchainId +
				" failed with the following error: " + err.toString());

            if(err.statusCode === 404) {
                return res.status(404).json({ "description": err.toString() });
            }

			return res.status(500).json({ "description": err });
		}

		if (!doc) {
			// no doc were updated and neither created so the document for the service was not found
			logger.error(logPrefix + "Binding the service instance with" +
				" ID: " + serviceInstanceId + " to toolchain ID: " + toolchainId +
				" failed since the service instance was not found");
            return res.status(404).json({ "description": "service instance not found" });
		}

		logger.debug(logPrefix + "Binding the service instance with" +
				" ID: " + serviceInstanceId + " to toolchain ID: " + toolchainId +
				" done");
		
		// Provide the notification url for the toolchain lifecycle event
//		var toolchain_lifecycle_webhook_url = nconf.get("PROTOCOL") + "://" + nconf.get("_vcap_application:application_uris:0")
//			+ "/pagerduty-broker/api/v1/messaging/toolchains/"
//			+ toolchainId + "/service_instances/" + serviceInstanceId + "/lifecycle_events";
//		
//		return res.json({toolchain_lifecycle_webhook_url: toolchain_lifecycle_webhook_url}).status(200);			

		return res.status(204).json({});
	});
}

function patchServiceInstance(req, res /*, next*/) {
	var logPrefix = "[" + logBasePath + ".patchServiceInstance] ";
	var db = req.servicesDb;
	var sid = req.params.sid;
	var data = req.body;
	
	// only allow these properties to be updated
	var allowed = ["parameters", "service_id", "organization_guid"];
	var notAllowed = _.omit(data, allowed);
	if (Object.keys(notAllowed).length > 0) {
		return res.status(400).json({"description": "Can only update these service instance properties: " + allowed.join(", ")});
	}
	// TODO: for now we're ignoring service_id and organization_guid parameters on the request, should we take them into account?
	data = _.pick(data, "parameters");
	
	var params = data.parameters;
	
	logger.info(logPrefix + "Patching the service instance with ID: " + sid + " using parameters:" + JSON.stringify(params));	
	
	// only allow these properties in parameters to be updated
	var allowedParams = ["account_id", "api_key", "service_name", "user_email", "user_phone"];
	var notAllowedParams = _.omit(params, allowedParams);
	if (Object.keys(notAllowedParams).length > 0) {
		return res.status(400).json({"description": "Can only update these parameters properties: " + allowedParams.join(", ")});
	}
	params = _.pick(params, "account_id", "api_key", "service_name", "user_email", "user_phone");
	
	// validate properties to be udated
	if (Object.keys(params).length == 0) {
		return res.status(400).json({"description": "No service instance properties to update"});
	}

	db.get(sid, null, function(err, body) {
		if (err) {
			logger.error(logPrefix + "Retrieving the service instance with"
				+ " ID: " + sid+ " failed with the following"
				+ " error: " + err.toString());
			return res.status(404).json({"description": "Service instance " + sid + " not found"});
		} else if (!body.organization_guid) {
			logger.warn(logPrefix + "The service instance with ID " +
					serviceInstanceId + " does not have an organization_guid defined.");
		}
        var organizationId;
        if (req.body.organization_guid) {
        	// New organization
        	organizationId =req.body.organization_guid; 
        } else {
        	organizationId= body.organization_guid
        }
        var serviceCredentials = body.service_credentials;
		var existingParams = body.parameters;
		if (!params.account_id)
			params.account_id = existingParams.account_id;
		if (!params.api_key)
			params.api_key = existingParams.api_key;
		if (!params.service_name)
			params.service_name = existingParams.service_name;
		if (!params.user_email)
			params.user_email = existingParams.user_email;
		if (!params.user_phone)
			params.user_phone = existingParams.user_phone;
		return createOrUpdateServiceInstance_(res, req, db, sid, organizationId, serviceCredentials, params, true/*patching*/);
	});
}

/**
*	Removes the service instance and the list from the service.
**/
function unbindServiceInstance (req, res/*, next*/) {
	var logPrefix = "[" + logBasePath + ".unbindServiceInstance] ";
	var db = req.servicesDb,
	serviceInstanceId = req.params.sid;

	logger.info(logPrefix + "Delete the service instance with" +
			" ID: " + serviceInstanceId);
	
	/**
	*	Find out the id of the list to remove.
	**/
	db.get(serviceInstanceId, null, function(err, body) {
		/**
		*	An error occurred during the request, or the service
		*	instance does not exist.
		**/
		if(err) {
			logger.error(logPrefix + "Retrieving the service instance with" +
				" ID: " + serviceInstanceId + " failed with the following" +
				" error: " + err.toString());

            if(err.statusCode === 404) {
                return res.status(404).json({ "description": err.toString() });
            }
			res.status(500).json({ "description": err.toString() });
			return;
		} else {
			request.del({
				uri: body.dashboard_url
			}, function(err, reqRes, body) {
				if(err) {
					logger.error(logPrefix + "Unbinding the service instance with" +
						" ID: " + serviceInstanceId + " failed with the following" +
						" error: " + err.toString());

					res.status(500).json({ "description": err.toString() });
					return;
				}

				return nanoDocUpdater()
					.db(db)
					.id(serviceInstanceId)
					.existingDoc(null)
					.shouldCreate(false)
					.shouldUpdate(function (published) {
						return (!published._deleted);
					})
					.merge(function (published) {
						return _.extend({ _deleted: true }, published);
					})
					.update(function (err) {
						if (err) {
							logger.error(logPrefix + "Removing the service instance with ID: " +
								serviceInstanceId + " failed with the following error: " + err.toString());
							
				            if(err.statusCode === 404) {
				                return res.status(404).json({ "description": err.toString() });
				            }
	
							return res.status(500).json({ "description": "Could not delete service instance: " + err.toString() });
						}
	
						return res.status(204).json({});
					});
			});
		}
	});
}

function unbindServiceInstanceFromToolchain (req, res/*, next*/) {
	var logPrefix = "[" + logBasePath + ".unbindServiceInstanceFromToolchain] ";
	var db = req.servicesDb,
	serviceInstanceId = req.params.sid,
	toolchainId = req.params.tid;

	logger.info(logPrefix + "Unbinding the service instance with" +
			" ID: " + serviceInstanceId + " from toolchain ID: " + toolchainId);
	
	return nanoDocUpdater()
	.db(db)
	.id(serviceInstanceId)
	.existingDoc(null)
	.newDoc(null)
	.shouldCreate(false)
	.shouldUpdate(function (published) {
		var result = _.find(published.toolchain_ids, function(obj) {
			if (obj.id === toolchainId) {
				return true;
			}
		});
		return result !== undefined;
	})
	.merge(function (published) {
		published.toolchain_ids = _.reject(published.toolchain_ids, function(obj) {
			if (obj.id === toolchainId) {
				return true;
			}
		});
		return published;
	})
	.update(function (err, doc) {
		if (err) {
			logger.error(logPrefix + "Unbinding the service instance with" +
				" ID: " + serviceInstanceId + " from toolchain ID: " + toolchainId +
				" failed with the following error: " + err.toString());

            if(err.statusCode === 404) {
                return res.status(404).json({ "description": err.toString() });
            }

			return res.status(500).json({ "description": "Could not unbind service instance: " + err.toString() });
		}

		if (!doc) {
			logger.error(logPrefix + "Unbinding the service instance with" +
				" ID: " + serviceInstanceId + " from toolchain ID: " + toolchainId +
				" failed since the service instance was not found");

			// no doc were updated and neither created so the document for the service was not found
            return res.status(404).json({ "description": "service instance not found" });
		}

		return res.status(204).json({});
	});
}

function unbindServiceInstanceFromAllToolchains (req, res/*, next*/) {
	var logPrefix = "[" + logBasePath + ".unbindServiceInstanceFromAllToolchains] ";
	var db = req.servicesDb,
	serviceInstanceId = req.params.sid;

	logger.info(logPrefix + "Unbinding the service instance with" +
			" ID: " + serviceInstanceId + " from all toolchains");
	
	return nanoDocUpdater()
	.db(db)
	.id(serviceInstanceId)
	.existingDoc(null)
	.newDoc(null)
	.shouldCreate(false)
	.shouldUpdate(function (published) {
		return published.toolchain_ids.length > 0;
	})
	.merge(function (published) {
		published.toolchain_ids = [];
		return published;
	})
	.update(function (err, doc) {
		if (err) {
			logger.error(logPrefix + "Unbinding the service instance with" +
				" ID: " + serviceInstanceId + " from all toolchains" +
				" failed with the following error: " + err.toString());

            if(err.statusCode === 404) {
                return res.status(404).json({ "description": err.toString() });
            }

			return res.status(500).json({ "description": "Could not unbind service instance: " + err.toString() });
		}

		if (!doc) {
			logger.error(logPrefix + "Unbinding the service instance with" +
				" ID: " + serviceInstanceId + " from all toolchains" +
				" failed since the service instance was not found");

			// no doc were updated and neither created so the document for the service was not found
            return res.status(404).json({ "description": "service instance not found" });
		}
		
		res.status(204).json({});
	});
}
