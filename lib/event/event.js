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
 pagerdutyUtils = require("../middleware/pagerduty-utils")
;

var logger = log4js.getLogger("pagerduty-broker"),
 	logBasePath = "lib.event.event";

r
.post("/toolchains/:tid/service_instances/:sid/lifecycle_events", incomingToolchainLifecycleEvent)
.post("/:source/service_instances/:sid", incomingEvent)
.post("/accept", incomingEventFromMessageStore)
;

module.exports = r;

var catalog = {
		"pipeline": require("./pipeline"),
		/* Only pipeline and toolchain currently supported
		 "github" : require("./github"),*/
		"toolchain": require("./toolchain")
}

function incomingToolchainLifecycleEvent(req, res) {
	var logPrefix = "[" + logBasePath + ".incomingToolchainLifecycleEvent] ";
	var toolchainId = req.params.tid,
		serviceInstanceId = req.params.sid
	;
	return processEvent(logPrefix, req, res, "toolchain", serviceInstanceId, toolchainId, req.body);
}	

function incomingEvent(req, res) {
	var logPrefix = "[" + logBasePath + ".incomingEvent] ";
	var source = req.params.source,
		serviceInstanceId = req.params.sid
	;
	// Retrieve the toolchain idS and nameS here - a service may be bound to multiple toolchains	
	return processEvent(logPrefix, req, res, source, serviceInstanceId, null, req.body);
	
}

function incomingEventFromMessageStore(req, res) {
	var logPrefix = "[" + logBasePath + ".incomingEventFromMessageStore] ";
	var source = req.body.service_id,
		serviceInstanceId = req.body.instance_id,
		toolchainId = req.body.toolchain_id
	;
	logger.debug(logPrefix + "Event received");	
	return processEvent(logPrefix, req, res, source, serviceInstanceId, toolchainId, req.body.payload);
}

function processEvent(logPrefix, req, res, source, serviceInstanceId, toolchainId, payload) {
	var db = req.servicesDb;
	
	// Find the serviceInstance record
	db.get(serviceInstanceId, null, function(err, body) {
		if(err && err.statusCode !== 404) {
			logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
			logger.error(logPrefix + "Retrieving the service instance with" +
				" ID: " + serviceInstanceId + " failed with the following" +
				" error: " + JSON.stringify(err));
			res.status(500).json({ "description": JSON.stringify(err) });
			return;
		} else if(err && err.statusCode === 404) {
			logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
			logger.debug(logPrefix + "Unknown service instance: " + serviceInstanceId);
			res.status(400).json({"description": "Unknown service instance: " + serviceInstanceId});
			return;
		} else {
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
				message = translator(toolchainId, payload, req.header("Authorization"), function(err, message) {
					if (err) {
						logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
						return res.status(500).json({ "description" : err});						
					}
					
					if (!message) {
						// event not critical, do not trigger an alert
						logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
						logger.debug(logPrefix + "Alert NOT sent to PagerDuty since not critical");
						res.status(204).json({});
						return;
					}
										
					// Find the service_key out of the serviceInstance record
					var service_key = body.parameters.service_key;
					logger.debug(logPrefix + "Sending message \"" + message + "\" to PagerDuty on service " + service_key);
					pagerdutyUtils.postAlert(logPrefix, service_key, message, function(err, response) {
						if (err) {
							logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
							logger.error(logPrefix + "Error posting PagerDuty alert: " + JSON.stringify(err));
							res.status(500).json({ "description" : err.toString() });	
							return;
						} else if (response.error) {
							logger.debug(logPrefix + "Event: " + JSON.stringify(payload));
							logger.error(logPrefix + "Bad request posting PagerDuty alert: " + response.error);
							res.status(400).json({ "description" : "Error - " + response.error});
							return;
						} else {
							res.status(204).json({});
							return;
						}
					});			
					
				});
			}
			
		}
	});
}


