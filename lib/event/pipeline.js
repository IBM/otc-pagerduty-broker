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
	async = require("async"),
	pipelineUtil = require("../util/pipeline-util"),
	toolchainUtil = require("../util/toolchain-util")
;

var logger = log4js.getLogger("otc-pagerduty-broker"),
logBasePath = "lib.event.pipeline"
;

// For now, convert Deploy job failure only
module.exports = function(toolchainId, event, toolchainCredentials, callback) {
	if (!event || !event.execution) 
		return callback(null, null, "event.execution is undefined");
	var execution = event.execution;
	if (execution.successful)
		return callback(null, null, "event.execution.successfull == true");
	if (event.event != "jobCompleted")
		return callback(null, null, "event.event != jobCompleted");
	var job = event.job;
//	if (!job || !job.extensionId)
//		return callback(null, null, "event.job.extensionId is undefined");
//	if (job.extensionId != "ibm.devops.services.pipeline.devops.ad_start"
//			&& job.extensionId != "ibm.devops.services.pipeline.devops.ad_finish")
//		return callback(null, null, "event.job.extensionId is not a known one");
	if (!job.componentName)
		return callback(null, null, "event.job.componentName is undefined");
	
	var jobExecution = _.findWhere(event.execution.jobExecutions, {"jobId": job.id});
	
	if (jobExecution && jobExecution.successful) {
		return callback(null, null, "jobExecution.successful == true for job.id == " + job.id);
	}
	
	if (!job.componentType)
		return callback(null, null, "event.job.componentType is undefined");
	if (job.componentType != "Deployer")
		return callback(null, null, "event.job.componentType != Deployer");
	
	// This is a failing one
	async.auto({
		pipelineInfo: function(asyncCallback) {
			pipelineUtil.getPipelineInfo(event.pipeline.id, toolchainCredentials, asyncCallback);
		},
		toolchainName: function(asyncCallback) {
			toolchainUtil.getToolchainName(toolchainId, toolchainCredentials, asyncCallback);
		},
		jobExecutionUrl: ["pipelineInfo", function(asyncCallback, results) {
			if (results.pipelineInfo.dashboard_url) {
				var url = results.pipelineInfo.dashboard_url + "/"; 
				url += event.stage.id;
				url += "/";
				url += job.id;
				if (jobExecution) {
					url += "/";
					url += jobExecution.jobExecutionId;		
				}				
				getTinyUrl(url, asyncCallback);
			} else {
				asyncCallback(null, null);
			}
		}]
	}, function(err, results) {
		if (err) {
			callback(err);
		} else {
			var message = "Job '" + job.componentName + "' in Stage '" + event.stage.name + "' #" + execution.number;
			message += " of Pipeline '" + results.pipelineInfo.label + "' from Toolchain '" + results.toolchainName + "'";
			message += " has FAILED";
			if (results.jobExecutionUrl != null) {
				message += " - ";
				message += results.jobExecutionUrl;
			}
			callback(null, message);
		}
	});			
}


function getTinyUrl(url, callback) {
	var logPrefix = "[" + logBasePath + ".getTinyUrl]";
	var ibm_snip_api_url = nconf.get("services:ibm_snip_api");
	var ibm_snip_api_key = nconf.get("IBM_SNIP_API_KEY");
	
	var snipShortenUrl = ibm_snip_api_url + "/shorten";
	request.post(snipShortenUrl, {json: true, form:{api_key: ibm_snip_api_key, url: url}}, function(error, response, body) {
		var tinyUrl = url;
		if (error) {
			logger.error(logPrefix + "Error while posting to " + snipShortenUrl + ":" + error);
		} else if (response.statusCode == 200) {
			if (body.status == "400") {
				logger.error(logPrefix + "Error while invoking snip for a tiny url: " + body.message);				
			} else {
				tinyUrl = body.url;
			}
		} else {
			logger.error(logPrefix + "Error while posting to " + snipShortenUrl + " - statusCode:" + response.statusCode);			
		}
		return callback(null, tinyUrl);
	});
}
