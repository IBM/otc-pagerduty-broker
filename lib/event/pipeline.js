/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015, 2016. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
"use strict";


var _ = require("underscore"),
	log4js = require("log4js"),
	nconf = require('nconf'),
	request = require("request"),
	async = require("async")
;

var logger = log4js.getLogger("otc-pagerduty-broker"),
logBasePath = "lib.event.pipeline"
;

// For now, convert Active Deploy job failure only
module.exports = function(toolchainId, event, authorization, callback) {
	if (!event || !event.execution) 
		return callback(null, null);
	var execution = event.execution;
	if (execution.successful)
		return callback(null, null);
	if (event.event != "jobCompleted")
		return callback(null, null);
	var job = event.job;
	if (!job || !job.extensionId)
		return callback(null, null);
	if (job.extensionId != "ibm.devops.services.pipeline.devops.ad_start"
			&& job.extensionId != "ibm.devops.services.pipeline.devops.ad_finish")
		return callback(null, null);
	if (!job.componentName)
		return callback(null, null);
	
	var jobExecution = _.findWhere(event.execution.jobExecutions, {"jobId": job.id});
	
	// This is a failing one
	// Retrieve the pipeline dashboard and toolchain information before assembling the text message
	
	async.parallel({
		pipelineInfo: function(asyncCallback) {
			getPipelineInfo(event.pipeline.id, authorization, asyncCallback);
		},
		toolchainName: function(asyncCallback) {
			getToolchainName(toolchainId, authorization, asyncCallback);
		}
	}, function(err, results) {
		if (err) {
			callback(err);
		} else {
			var message = "Job '" + job.componentName + "' in Stage '" + event.stage.name + "' #" + execution.number;
			message += " of Pipeline '" + results.pipelineInfo.label + "' from Toolchain '" + results.toolchainName + "'";
			message += " has FAILED";
			if (results.pipelineInfo.dashboard_url) {
				message += " - ";
				var url = results.pipelineInfo.dashboard_url + "/"; 
				url += event.stage.id;
				url += "/";
				url += job.id;
				if (jobExecution) {
					url += "/";
					url += jobExecution.jobExecutionId;		
				}
				message += url;
			}
		
			callback(null, message);
		}
	});	
}


function getPipelineInfo(pipelineId, authorization, callback) {
	var logPrefix = "[" + logBasePath + ".getPipelineInfo]";

	var otc_api_url = nconf.get("services:otc-api");

	var options = {};
	options.url = otc_api_url + "/service_instances/" + pipelineId;
	options.headers = {"Authorization" : authorization};
	options.json = true;
	request.get(options, function(error, response, body) {
		if (error) {
			logger.error(logPrefix + "Error while getting " + options.url + ":" + error);
			return callback(null, {label: pipelineId});
		} else if (response.statusCode == 200) {
			return callback(null, {label: body.parameters.label, dashboard_url:body.dashboard_url});
		}
		return callback(null, {label: pipelineId});
	});
}

function getToolchainName(toolchainId, authorization, callback) {
	var logPrefix = "[" + logBasePath + ".getToolchainName]";

	var otc_api_url = nconf.get("services:otc-api");

	var options = {};
	options.url = otc_api_url + "/toolchains/" + toolchainId;
	options.headers = {"Authorization" : authorization};
	options.json = true;
	request.get(options, function(error, response, body) {
		if (error) {
			logger.error(logPrefix + "Error while getting " + options.url + ":" + error);
		} else if (response.statusCode == 200) {
			if (body.items.length > 0) {
				return callback(null, body.items[0].name);
			} else {
				logger.error(logPrefix + "No toolchain found at " + options.url + " - no items returned");				
			}
		} else {
			logger.error(logPrefix + "No toolchain found at " + options.url + ":" + response.statusCode);			
		} 
		// No toolchain found !
		callback(null, toolchainId);
	});	
}
