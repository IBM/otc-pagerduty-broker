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

var logger = log4js.getLogger("otc-pagerduty-broker"),
 	logBasePath = "lib.event.event";

r
.post("/toolchain/:tid/service_instances/:sid/lifecycle_events", incomingToolchainLifecycleEvent)
.post("/:source/service_instances/:sid", incomingEvent);

module.exports = r;

var catalog = {
		"pipeline": require("./pipeline"),
		"github" : require("./github"),
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

function processEvent(logPrefix, req, res, source, serviceInstanceId, toolchainId, payload) {
	var db = req.servicesDb;
	
	// Find the serviceInstance record
	db.get(serviceInstanceId, null, function(err, body) {
		if(err && err.statusCode !== 404) {
			logger.error(logPrefix + "Retrieving the service instance with" +
				" ID: " + serviceInstanceId + " failed with the following" +
				" error: " + JSON.stringify(err));
			res.status(500).json({ "description": JSON.stringify(err) });
			return;
		} else if(err && err.statusCode === 404) {
			res.status(400).json({"description": err.toString()});
			return;
		} else {
			// According to :source value, we will route to the appropriate event to pagerduty message translator
			// If the :source is not known, warning in the log 
			var message;
			var translator = catalog[source]; 
			if (!translator) {
				logger.warning(logPrefix + "No event to pagerduty message translator found for " + source);
				message = {};
				message.username = source;
				message.text = JSON.stringify(payload);
			} else {
				// TODO Toolchain id & label passed to the translator
				// TODO Services label and dashboard_url (parameters) provided to the translator
				message = translator(payload);
			}
			
			if (!message) {
				// event not critical, do not trigger an alert
				return;
			}
								
			// Find the service_key out of the serviceInstance record
			var service_key = body.parameters.service_key;

			//console.log(JSON.stringify(message));
			
			pagerdutyUtils.postAlert(logPrefix, service_key, message, function(err, response) {
				if (err) {
					res.status(500).json({ "description" : err.toString() });	
					return;
				} else if (response.error) {
					res.status(400).json({ "description" : "Error - " + response.error});
					return;
				} else {
					res.status(204).json({});
					return;
				}
			});			
		}
	});
}


