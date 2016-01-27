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
 express = require("express"),
 log4js = require("log4js"),
 nanoDocUpdater = require("nano-doc-updater"),
 nconf = require("nconf"),
 r = express.Router(),
 request = require("request"),
 _ = require("underscore"),
 pagerDutyUtils = require("./pagerduty-utils")
;

var logger = log4js.getLogger("pagerduty-broker"),
 	logBasePath = "lib.middleware.service_instances";

r
.put("/:sid", createOrUpdateServiceInstance)
.put("/:sid/toolchains/:tid", bindServiceInstanceToToolchain)
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
		organizationId = req.body.organization_guid;
	
	// req.body (from external request) is not the same as body (response from Cloudant dB).
	if(!req.body.service_id) {
		return res.status(400).json({ "description": "Error: service_id is a required parameter." });
	}
	if(!organizationId) {
		return res.status(400).json({ "description": "Error: organization_guid is a required parameter." });
	}
	if(!isValidOrganization(organizationId, req.user.organizations)) {
		return res.status(403).json({ "description": "Error: User is not part of the organization." });
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
			// TODO instance_id = serviceInstanceId ?
			return createOrUpdateServiceInstance_(res, req, db, serviceInstanceId, organizationId, parametersData)
		} else {
			/**
			*	The service instance exists but the parameters needs an update.
			**/
			// unique instance_id from the Cloudant DB also known as the service instance ID (sid)
			// var instanceId = body.instance_id;
			return createOrUpdateServiceInstance_(res, req, db, serviceInstanceId, organizationId, parametersData)
		}
	});
}

function createOrUpdateServiceInstance_(res, req, db, serviceInstanceId, organizationId, parametersData) {
	var logPrefix = "[" + logBasePath + ".createOrUpdateServiceInstance_] ";
	var account_id;
	var api_token;
	var service_name;
	var user_email;
	var user_phone;
	if (parametersData) {
		account_id = parametersData.account_id;
		api_token = parametersData.api_token;
		service_name = parametersData.service_name;
		user_email = parametersData.user_email;
		user_phone= parametersData.user_phone;
	}
	var parameters = {};
	if (account_id && api_token) {
		var baseUrl = nconf.get("services:pagerduty");
		var httpsPrefix = "https://";
		var index = baseUrl.indexOf(httpsPrefix);
		if (index != 0) {
			return res.status(400).json({ "description": "Invalid pagerduty service: " + baseUrl + ", it should start with " + httpsPrefix});
		}
		var url = httpsPrefix + account_id + '.' + baseUrl.substring(httpsPrefix.length);
		var apiUrl = url + "/api/v1";
		pagerDutyUtils.getOrCreatePagerDutyService(res, apiUrl, api_token, service_name, user_email, user_phone, function(service) {
			if (!service)
				return;
			var dashboardUrl = url + service.service_url;
			parameters.label = service_name;
			parameters.service_id = service.id;
			parameters.service_key = service.service_key;
			return doServiceUpdate(res, req, db, serviceInstanceId, parameters, service.id, organizationId, dashboardUrl);
		});
	} else {
		// Creation of incomplete service instance
		return doServiceUpdate(res, req, db, serviceInstanceId, parameters, "n/a", organizationId, "https://www.pagerduty.com");
	}	
}

/**
*	Handles updating the service instance with the new properties.
**/
function doServiceUpdate (res, req, db, serviceInstanceId, parametersData, instanceId, organizationId, dashboardUrl) {
	var logPrefix = "[" + logBasePath + ".doServiceUpdate] ";

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
				organization_guid: organizationId
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

					res.status(500).json({ "description": err.toString() });
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
	isOrg;
	
	var updatedDocument;
	
	return nanoDocUpdater()
	.db(db)
	.id(serviceInstanceId)
	.existingDoc(null)
	.newDoc(null)
	.shouldUpdate(function (published) {
		isOrg = isValidOrganization(published.organization_guid, req.user.organizations);

		return (published.toolchain_ids.indexOf(toolchainId) === -1 && isOrg);
	})
	.merge(function (published) {
		published.toolchain_ids.push(toolchainId);
		updatedDocument = published;
		return published;
	})
	.update(function (err) {
		if (err) {
			logger.error(logPrefix + "Binding the service instance with" +
				" ID: " + serviceInstanceId + " to toolchain ID: " + toolchainId +
				" failed with the following error: " + err.toString());

			return res.status(500).json({ "description": err });
		}
		else if(!isOrg) {
			return res.status(403).json({ "description": "Error: User is not part of the organization." });
		}

		// TODO: remove the following when we get notified through the messaging service
		registerPipelineWebhooks(req);

		logger.debug(logPrefix + "Binding the service instance with" +
				" ID: " + serviceInstanceId + " to toolchain ID: " + toolchainId +
				" done");
		
		// Provide the notification url for the toolchain lifecycle event
		var toolchain_lifecycle_webhook_url = nconf.get("PROTOCOL") + "://" + nconf.get("_vcap_application:application_uris:0")
			+ "/pagerduty-broker/api/v1/messaging/toolchains/"
			+ toolchainId + "/service_instances/" + serviceInstanceId + "/lifecycle_events";
		
		return res.json({toolchain_lifecycle_webhook_url: toolchain_lifecycle_webhook_url}).status(200);			

	});
}

//TODO: remove the following when we get notified through the messaging service
function registerPipelineWebhooks(req) {
	var logPrefix = "[" + logBasePath + ".registerPipelineWebhooks] ";
	// Temporary - look if there is a pipeline tool in the toolchain
	// if yes, then create a webhook to be notified of event

	var db = req.servicesDb,
	serviceInstanceId = req.params.sid,
	toolchainId = req.params.tid;
	
	// Check if there is a pipeline tool in the toolchain
	var otc_api_url = nconf.get("services:otc-api");
	
	// sample
	//otc_api_url = "https://otc-api.stage1.ng.bluemix.net/api/v1";
	//toolchainId = "d301d909-0891-466c-aca9-653888e09a9a";
	
	var options = {};
	options.url = otc_api_url + "/toolchains/" + toolchainId + "/services";
	options.headers = {"Authorization" : req.header("Authorization")};
	options.json = true;
	//console.log(JSON.stringify(options));
	request.get(options, function(error, response, body) {
		if (error) {
			logger.error(logPrefix + "Error while getting " + options.url + ":" + error);
		} else if (response.statusCode == 200) {
			var pipeline_instances = _.where(response.body.services, {"service_id":"pipeline"});
			_.each(pipeline_instances, function (pipeline_instance) {
				logger.info(logPrefix + "Registering webhook for pipeline:" + pipeline_instance.instance_id + " - " + pipeline_instance.dashboard_url);
				registerPipelineWebhook(req, pipeline_instance);
			});
		} else {
			logger.error(logPrefix + "Error while getting " + options.url + ":" + response.statusCode);			
		}
	});	
}

//TODO: remove the following when we get notified through the messaging service
function registerPipelineWebhook(req, pipeline) {
	var logPrefix = "[" + logBasePath + ".registerPipelineWebhook] ";

	var db = req.servicesDb,
	serviceInstanceId = req.params.sid,
	toolchainId = req.params.tid;

	var url = nconf.get("services:otc-webhook-manager") + 
		"/webhook/" + pipeline.service_id + "/" + pipeline.instance_id + "/outgoing";
	
	var webhook_url = nconf.get("PROTOCOL") + "://" + nconf.get("_vcap_application:application_uris:0");
	webhook_url += "/pagerduty-broker/unsecured/event/v1/pipeline/service_instances/" + serviceInstanceId;

	var webhook = {
		"label" : "temp webhook to pagerduty broker for pipeline " + pipeline.instance_id,
		"url" : webhook_url,
		"enabled" : true
	}
	
	var options = {};
	options.url = url;
	options.headers = {"Authorization" : req.header("Authorization")};
	options.body = webhook;
	options.json = true;
	
	request.post(options, function(error, response, body) {
		if (error) {
			logger.error(logPrefix + "Error while getting " + options.url + ":" + error);
		} else if (response.statusCode != 201) {
			logger.error(logPrefix + "Error while getting " + options.url + ":" + response.statusCode);			
		} else {
	   		 var tokens = response.headers.location.split("/");
			 var outgoing_webhook_id = tokens.pop();
			 if (outgoing_webhook_id.length==0) {
				 outgoing_webhook_id = tokens.pop();
			 }
			 // Save the outgoing webhook id for future removal
			 // add it to the record with toolchain id
			 var pipeline_and_webhook_id = {
					 "toolchain_id" : toolchainId,
					 "pipeline_id" : pipeline.instance_id,
					 "webhook_id" : outgoing_webhook_id
			 }
			logger.info(logPrefix + "Successfull creation of a Outgoing WebHook instance [" + outgoing_webhook_id + "] for pipeline " + pipeline.instance_id);
			 
			 // push this in the cloudant record for pagerduty broker
			 return nanoDocUpdater()
				.db(db)
				.id(serviceInstanceId)
				.existingDoc(null)
				.newDoc(null)
				.shouldUpdate(function (published) {
					if (published) {
						return true;						
					} else {
						return false;
					}
				})
				.merge(function (published) {
					if (published) {
						published.pipeline_and_webhook_ids.push(pipeline_and_webhook_id);						
					}
					return published;
				})
				.update(function (err) {
					if (err) {
						logger.error(logPrefix + "Registering pipeline and webhook ids for pagerduty broker instance " + serviceInstanceId + " failed with the following error: " + err.toString());
					}
				});
		}
	});
}

/**
*	Removes the service instance and the list from the service.
**/
function unbindServiceInstance (req, res/*, next*/) {
	var logPrefix = "[" + logBasePath + ".unbindServiceInstance] ";
	var db = req.servicesDb,
	serviceInstanceId = req.params.sid,
	isOrg;

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
						isOrg = isValidOrganization(published.organization_guid, req.user.organizations);

						return (!published._deleted && isOrg);
					})
					.merge(function (published) {
						return _.extend({ _deleted: true }, published);
					})
					.update(function (err) {
						if (err) {
							logger.error(logPrefix + "Removing the service instance with ID: " +
								serviceInstanceId + " failed with the following error: " + err.toString());
							return res.status(500).json({ "description": "Could not delete service instance: " + err.toString() });
						}
						else if(!isOrg) {
							return res.status(403).json({ "description": "Error: User is not part of the organization." });
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
	toolchainId = req.params.tid,
	isOrg;

	return nanoDocUpdater()
	.db(db)
	.id(serviceInstanceId)
	.existingDoc(null)
	.newDoc(null)
	.shouldUpdate(function (published) {
		isOrg = isValidOrganization(published.organization_guid, req.user.organizations);

		return (published.toolchain_ids.indexOf(toolchainId) !== -1 && isOrg);
	})
	.merge(function (published) {
		published.toolchain_ids = _.without(published.toolchain_ids, toolchainId);
		return published;
	})
	.update(function (err) {
		if (err) {
			logger.error(logPrefix + "Unbinding the service instance with" +
				" ID: " + serviceInstanceId + " from toolchain ID: " + toolchainId +
				" failed with the following error: " + err.toString());

			return res.status(500).json({ "description": "Could not unbind service instance: " + err.toString() });
		}
		else if(!isOrg) {
			return res.status(403).json({ "description": "Error: User is not part of the organization." });
		}

		return res.status(204).json({});
	});
}

function unbindServiceInstanceFromAllToolchains (req, res/*, next*/) {
	var logPrefix = "[" + logBasePath + ".unbindServiceInstanceFromAllToolchains] ";
	var db = req.servicesDb,
	serviceInstanceId = req.params.sid;

	return nanoDocUpdater()
	.db(db)
	.id(serviceInstanceId)
	.existingDoc(null)
	.newDoc(null)
	.shouldUpdate(function (published) {
		return published.toolchain_ids.length > 0;
	})
	.merge(function (published) {
		published.toolchain_ids = [];
		return published;
	})
	.update(function (err) {
		if (err) {
			logger.error(logPrefix + "Unbinding the service instance with" +
				" ID: " + serviceInstanceId + " from all toolchains" +
				" failed with the following error: " + err.toString());

			return res.status(500).json({ "description": "Could not unbind service instance: " + err.toString() });
		}

		res.status(204).json({});
	});
}

/**
* Note: Brokers implementing this check should ideally reference an auth-cache.
* @param orgToValidate - The organization_guid to check the user is a member of.
* @param usersOrgs - An array of organization_guids the user is actually a member of.
**/
function isValidOrganization (orgToValidate, usersOrgs) {

    if (orgToValidate && usersOrgs) {
        for (var i = 0; i < usersOrgs.length; i++) {
            if (usersOrgs[i].guid === orgToValidate) {
                return true;
            }
        }
    }

    return false;
}