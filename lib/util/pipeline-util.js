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
 log4js = require("log4js"),
 nconf = require("nconf"),
 _ = require('underscore'),
 request = require("request"),
 tiamUtil = require("../util/tiam-util")
;

var logger = log4js.getLogger("otc-pagerduty-broker"),
	logBasePath = "lib.util.pipeline-util"
;

var otc_api_url = nconf.get("services:otc_api");
var otc_ui_url = nconf.get("services:otc_ui");

exports.getPipelineInfo = getPipelineInfo;

function getPipelineInfo(pipelineId, toolchainCredentials, callback) {	
	var logPrefix = "[" + logBasePath + ".getPipelineInfo] ";
	logger.debug(logPrefix + "Getting pipeline info for " + pipelineId);
	// The target is fabric which is the default
	tiamUtil.getCredentials(toolchainCredentials, null, function(err, credentials) {
		if (err) {
			logger.error(logPrefix + "No credentials obtained from TIAM : " + err);
			return callback(null, {label: pipelineId});
		}
		return getPipelineInfo_(pipelineId, credentials, function(err, pipelineInfo) {
			if (err && err != 401) {
				return callback(null, {label: pipelineId});
			} if (err && err === 401) {
				// TIAM credentials may be stale. Let's retry with a new TIAM
				logger.debug(logPrefix + "Use new TIAM credentials to invoke otc-api");
				return tiamUtil.getCredentials(toolchainCredentials, {refresh: true}, function(err, credentials) {
					if (err) {
						logger.error(logPrefix + "No credentials obtained from TIAM : " + err);
						return callback(null, {label: pipelineId});
					}
					return getPipelineInfo_(pipelineId, credentials, function(err, pipelineInfo) {
						if (err) {
							logger.error(logPrefix + "Failed to get pipeline info : " + err);
							return callback(null, {label: pipelineId});							
						} else {
							return callback(null, pipelineInfo);
						}
					});
				});
			} else {
				return callback(null, pipelineInfo);
			}
		});
	});
}

function getPipelineInfo_(pipelineId, credentials, callback) {
	var logPrefix = "[" + logBasePath + ".getPipelineInfo_] ";
	var options = {};
	options.url = otc_api_url + "/service_instances/" + pipelineId;
	options.headers = {"Authorization" : "Basic " + credentials};
	options.json = true;
	logger.debug(logPrefix + "Invoking otc-api to find pipeline info for " + pipelineId);
	request.get(options, function(error, response, body) {
		if (error) {
			logger.error(logPrefix + "Error while getting " + options.url + ":" + error);
			return callback(error);
		} else if (response.statusCode == 200) {
			var dashboard_url = body.dashboard_url;
			if (!dashboard_url.startsWith('http')) {
				// see https://hub.jazz.net/ccm09/web/projects/idsorg%20%7C%20One%20Ring%20Track%20and%20Plan#action=com.ibm.team.workitem.viewWorkItem&id=58417
				// make it an absolute url
				var lastSlash = otc_ui_url.lastIndexOf('/');
				if (lastSlash != -1) {
					var env_url = otc_ui_url.substring(0, lastSlash);
					dashboard_url = env_url + dashboard_url;
				}
			}
			return callback(null, {label: body.parameters.label, api_url: body.parameters.api_url, dashboard_url:dashboard_url});
		} else {
			return callback(response.statusCode);
		}
	});	
}