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
 nconf = require("nconf"),
 r = express.Router(),
 request = require("request"),
 _ = require("underscore"),
 pagerdutyUtils = require("../middleware/pagerduty-utils"),
 tiamUtil = require("../util/tiam-util")
;

var logger = log4js.getLogger("pagerduty-broker"),
 	logBasePath = "lib.event.event";

r
.post("/toolchains/:tid/service_instances/:sid/lifecycle_events", incomingToolchainLifecycleEvent, getServiceInstance, checkCredentials, processEvent)
.post("/:source/service_instances/:sid", incomingEvent, getServiceInstance, checkCredentials, processEvent)
.post("/accept", incomingEventFromMessageStore, getServiceInstance, checkCredentials, processEvent)
;

module.exports = r;

var catalog = {
		"pipeline": require("./pipeline"),
		/* Only pipeline and toolchain currently supported
		 "github" : require("./github"),*/
		"toolchain": require("./toolchain")
}

function incomingToolchainLifecycleEvent(req, res, next) {
	var logPrefix = "[" + logBasePath + ".incomingToolchainLifecycleEvent] ";
	var toolchainId = req.params.tid,
		serviceInstanceId = req.params.sid
	;
	// We are currenlty not doing anything when receiving notification from otc-api anymore
	// because this is now coming from LMS to post to PagerDuty
	// However we should use this endpoint for the functionnal part later on
	// and also local dev or dev-test environment because LMS is not in place in this kind of test
	//
	if (process.env.NODE_ENV == "local-dev" || process.env.NODE_ENV == "dev-test") {
		var incomingEvent = {};
		incomingEvent.source = "toolchain";
		incomingEvent.serviceInstanceId = serviceInstanceId;
		incomingEvent.toolchainId = toolchainId;
		incomingEvent.payload = req.body;
		req.incomingEvent = incomingEvent;
		
		next();
		
		//return processEvent(req, res, , serviceInstanceId, toolchainId, req.body, req.header("Authorization"));
	} else {
		res.status(204).json({});
	}
	
}

function incomingEvent(req, res, next) {
	var logPrefix = "[" + logBasePath + ".incomingEvent] ";
	var source = req.params.source,
		serviceInstanceId = req.params.sid
	;
	// We are currenlty not doing anything when receiving notification from pipeline anymore
	// because this is now coming from LMS to post to PagerDuty
	// However we should use this endpoint for the functionnal part later on
	// and also local dev or dev-test environment because LMS is not in place in this kind of test
	//
	if (process.env.NODE_ENV == "local-dev" || process.env.NODE_ENV == "dev-test") {
		var incomingEvent = {};
		incomingEvent.source = source;
		incomingEvent.serviceInstanceId = serviceInstanceId;
		// incomingEvent.toolchainId = toolchainId; // Retrieve the toolchain idS and nameS here - a service may be bound to multiple toolchains
		incomingEvent.payload = req.body;
		req.incomingEvent = incomingEvent;
		
		next();
		
		//return processEvent(req, res, , serviceInstanceId, toolchainId, req.body, req.header("Authorization"));
	} else {
		res.status(204).json({});
	}
}

function incomingEventFromMessageStore(req, res, next) {
	var logPrefix = "[" + logBasePath + ".incomingEventFromMessageStore] ";
	var source = req.body.service_id,
		serviceInstanceId = req.body.instance_id,
		toolchainId = req.body.toolchain_id
	;

	var incomingEvent = {};
	incomingEvent.source = source;
	incomingEvent.serviceInstanceId = serviceInstanceId;
	incomingEvent.toolchainId = toolchainId;
	incomingEvent.payload = req.body.payload;
	req.incomingEvent = incomingEvent;

	logger.debug(logPrefix + "Incoming event from Message store");
	
	next();
	
	// return processEvent(req, res, source, serviceInstanceId, toolchainId, req.body.payload, req.header("Authorization"));
}

function getServiceInstance(req, res, next) {
	var logPrefix = "[" + logBasePath + ".getServiceInstance] ";
	
	var source = req.incomingEvent.source;
	var serviceInstanceId = req.incomingEvent.serviceInstanceId;
	var toolchainId = req.incomingEvent.toolchainId;
	
	if (!source || !serviceInstanceId || !toolchainId) {
		return res.status(400).json({ "description": "Error: no service_id, instance_id or toolchain_id for the incoming event."});
	}

	logger.debug(logPrefix + "Looking for service instance record");
	
	// Find the serviceInstance record
	var db = req.servicesDb;
	db.get(serviceInstanceId, null, function(err, body) {
		if(err && err.statusCode !== 404) {
			logger.error(logPrefix + "Retrieving the service instance with" +
				" ID: " + serviceInstanceId + " failed with the following" +
				" error: " + err.toString());
			return res.status(500).json({ "description": err.toString() });
		} else if(err && err.statusCode === 404) {
			logger.error(logPrefix + "Service instance with" +
					" ID: " + serviceInstanceId + " not found");
			return res.status(400).json({"description": "no service instance found for id " + serviceInstanceId});
		} else {
			req.serviceInstance = body;
			next();
		}
	});
}

function checkCredentials(req, res, next) {
	var logPrefix = "[" + logBasePath + ".checkCredentials] ";
	
	// Find toolchain credentials
	var toolchainId = req.incomingEvent.toolchainId;
	var toolchain_id = _.findWhere(req.serviceInstance.toolchain_ids, {id: toolchainId});
	if (toolchain_id) {
		logger.debug(logPrefix + "Toolchain id and credentials found");
		req.toolchain_id = toolchain_id;
	}

	
	// Introspect credentials if basic authorization
	var authHeader = req.header('Authorization');
	if (authHeader) {
		// Split header and grab values from it.
		var authHeaderParts = authHeader.split(/\s+/);
		var authPrefix = String(authHeaderParts[0]).toLowerCase();
		var authValue = authHeaderParts[1];
		if (authPrefix === "basic") {
			logger.debug(logPrefix + "Basic auth - Introspect credentials given toolchain credentials");
			// introspect credentials according to toolchain credentials
			if (!toolchain_id) {
	            return res.status(401).json({ message: 'No toolchainCredentials found'});
			}
			return tiamUtil.introspectCredentials(toolchain_id.credentials, authValue, null, function(err, userData) {
				if (err) {
					if (err == 401) {
			            return res.status(401).json({ message: 'An invalid authorization header was passed in'});						
					} else {
						return res.status(500).json({ message: 'Error while validating basic credentials'});
					}
				} else {
					next();
				}
			});
		}
	}
	// TODO This next() will be removed when only Basic allowed
	// it will be replaced by:
	// return res.status(401).json({ message: 'An invalid authorization header was passed in'});	
	next();
}

function processEvent(req, res, next) {
	var logPrefix = "[" + logBasePath + ".processEvent] ";
	var source = req.incomingEvent.source;
	var serviceInstanceId = req.incomingEvent.serviceInstanceId;
	var toolchainId = req.incomingEvent.toolchainId;
	var payload = req.incomingEvent.payload;
	var serviceInstance = req.serviceInstance;
	var toolchainCredentials = req.toolchain_id.credentials;
	var toolchainId = req.toolchain_id.id;
	
	// According to :source value, we will route to the appropriate event to pagerduty message translator
	// If the :source is not known, warning in the log 
	var message;
	var translator = catalog[source]; 
	if (!translator) {
		logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
		logger.debug(logPrefix + "Event ignored since source service_id: \"" + source + "\" is not supported");
		res.status(204).json({});
		return;
	} else {
		message = translator(toolchainId, payload, toolchainCredentials, function(err, message, notSentReason) {
			if (err) {
				logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
				return res.status(500).json({ "description" : err});						
			}
			
			if (!message) {
				// event not critical, do not trigger an alert
				logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
				logger.debug(logPrefix + "Alert NOT sent to PagerDuty since " + notSentReason);
				return res.status(204).json({});
			}
								
			// Find the service_key 
			tiamUtil.getServiceData(serviceInstance.service_credentials, function(err, data) {
				var service_key;
				if (err == 404) {
					// In case of service_instance previous of TIAM Service Data adoption
					logger.error(logPrefix + "No service key from TIAM Service - using parameters.service_key if any");
					service_key = serviceInstance.parameters.service_key;
					if (!service_key) {
						logger.error(logPrefix + "Error while retrieving service key from TIAM Service:" + err + ". No service key found.");
						return res.status(500).json({ "description" : "Error while retrieving service key"});					
					}
				} else if (err) {
					logger.error(logPrefix + "Error while retrieving service key from TIAM Service:" + err);
					return res.status(500).json({ "description" : "Error while retrieving service key"});					
				} else {
					service_key = data.service_key;					
				}
				logger.debug(logPrefix + "Sending message \"" + message + "\" to PagerDuty on service " + service_key);
				pagerdutyUtils.postAlert(logPrefix, service_key, message, function(err, response) {
					if (err) {
						logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
						logger.error(logPrefix + "Error posting PagerDuty alert: " + JSON.stringify(err));
						return;
					} else if (response.error) {
						logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
						logger.error(logPrefix + "Bad request posting PagerDuty alert: " + response.error);
						res.status(400).json({ "description" : response.error});
						return;
					} else {
						res.status(204).json({});
						return;
					}
				});			
			});
		});
	}
}


