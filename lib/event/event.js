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

var logger = log4js.getLogger("otc-pagerduty-broker"),
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
	logger.debug(logPrefix + "Processing toolchain lifecycle event");
	
	var toolchainId = req.params.tid,
		serviceInstanceId = req.params.sid
	;
	// We are currently not doing anything when receiving notification from otc-api anymore
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
	logger.debug(logPrefix + "Processing generic event");

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
	logger.debug(logPrefix + "Processing DLMS event");
	
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

	next();
	
	// return processEvent(req, res, source, serviceInstanceId, toolchainId, req.body.payload, req.header("Authorization"));
}

function getServiceInstance(req, res, next) {
	var logPrefix = "[" + logBasePath + ".getServiceInstance] ";
	logger.debug(logPrefix + "Looking for service instance record");
	
	var source = req.incomingEvent.source;
	var serviceInstanceId = req.incomingEvent.serviceInstanceId;
	var toolchainId = req.incomingEvent.toolchainId;
	
	if (!source || !serviceInstanceId || !toolchainId) {
		var reason;
		if (!source)
			reason = "service_id is undefined";
		if (!serviceInstanceId)
			reason = "instance_id is undefined";
		if (!toolchainId)
			reason = "toolchain_id is undefined";
		logBadRequest(logPrefix, reason);
		return res.status(400).json({description: reason});
	}

	// Find the serviceInstance record
	var db = req.servicesDb;
	db.get(serviceInstanceId, null, function(err, body) {
		if(err && err.statusCode !== 404) {
			logger.error(logPrefix + "Retrieving the service instance with" +
				" ID: " + serviceInstanceId + " failed with the following" +
				" error: " + err.toString());
			return res.status(500).json({ "description": err.toString() });
		} else if(err && err.statusCode === 404) {
			var reason = "no service instance found for instance_id = " + serviceInstanceId;
			logBadRequest(logPrefix, reason);
			return res.status(400).json({description: reason});
		} else {
			req.serviceInstance = body;
			next();
		}
	});
}

function checkCredentials(req, res, next) {
	var logPrefix = "[" + logBasePath + ".checkCredentials] ";
	logger.debug(logPrefix + "Checking credentials");
	
	// Find toolchain credentials
	var toolchainId = req.incomingEvent.toolchainId;
	var toolchain_id = _.findWhere(req.serviceInstance.toolchain_ids, {id: toolchainId});
	if (toolchain_id) {
		logger.debug(logPrefix + "Toolchain id and credentials found");
		req.toolchain_id = toolchain_id;
	} else {
		var reason = "no toolchain credentials found for toolchain_id = " + toolchainId;
		logUnauthorized(logPrefix, reason);
		return res.status(401).json({description: reason});
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
			return tiamUtil.introspectCredentials(toolchain_id.credentials, authValue, null, function(err, userData) {
				if (err) {
					if (err == 401) {
						var reason = "invalid authorization header " + authHeader;
						logUnauthorized(logPrefix, reason);
						return res.status(401).json({description: reason});
					} else {
						logger.error(logPrefix + "Introspecting credentials for" +
							" authValue: " + authValue + " failed with the following" +
							" error: " + err.toString());
						return res.status(500).json({ description: 'Error while validating basic credentials'});
					}
				} else {
					next();
				}
			});
		}
	}
	var reason = "invalid authorization header " + authHeader;
	logUnauthorized(logPrefix, reason);
	return res.status(401).json({description: reason});
}

function processEvent(req, res, next) {
	var logPrefix = "[" + logBasePath + ".processEvent] ";
	logger.debug(logPrefix + "Processing event");
	
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
								
			// Find the service_key out of the serviceInstance record
			var service_key = serviceInstance.parameters.service_key;
			
			// Send alert
			logger.debug(logPrefix + "Sending message \"" + message + "\" to PagerDuty on service " + service_key);
			pagerdutyUtils.postAlert(service_key, message, function(err, response) {
				if (err) {
					logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
					logger.error(logPrefix + "Error posting PagerDuty alert: " + JSON.stringify(err));
					return;
				} else if (response.error) {
					logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
					logBadRequest(logPrefix, response.error);
					return res.status(400).json({description: response.error});
				} else {
					res.status(204).json({});
					return;
				}
			});
		});
	}
}

function logBadRequest(logPrefix, reason) {
	logger.info(logPrefix + "Returning bad request (400): " + reason);
}

function logUnauthorized(logPrefix, reason) {
	logger.info(logPrefix + "Returning unauthorized (401): " + reason);
}


