/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
"use strict";

var
 log4js = require("log4js"),
 nanoDocUpdater = require("nano-doc-updater"),
 nconf = require("nconf"),
 request = require("request"),
 _ = require("underscore")
;

var logger = log4js.getLogger("otc-pagerduty-broker"),
 	logBasePath = "lib.middleware.pagerduty-utils";

module.exports.getPagerDutyUser = getPagerDutyUser;
module.exports.getOrCreatePagerDutyService = getOrCreatePagerDutyService;

function getPagerDutyUser(api_token, callback) {
	var logPrefix = "[" + logBasePath + ".getPagerDutyChannel] ";
    // TODO
}

function getOrCreatePagerDutyService(api_token, user, pagerduty_service_id, pagerduty_service_name, callback) {
	var logPrefix = "[" + logBasePath + ".getOrCreatePagerDutyService] ";

	if(!pagerduty_service_id && !pagerduty_service_name) {
		logger.error(logPrefix + "parameters' pagerduty information (id or name) not provided");
		return callback({ description:"pagerduty information (id or name) not provided"});
	}

	// TODO
}
