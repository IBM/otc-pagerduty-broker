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
	nconf = require('nconf'),
	_ = require('underscore')
;

module.exports = function(event) {
	
	// TODO event name needs to be retrieve elsewhere
	var event_name = event.name;
	
	var payload = event.payload;
	
	if (event_name == "issues") {
		return getMessageForIssuesEvent(payload);
	} 

	return null;
}


function getMessageForIssuesEvent(payload) {
	// TODO: return a message iff issue is critical
	return null;
}

function getProjectName(payload) {
	// TODO
	return "Project/Toolchain including Github Tool";
}

function getRepositoryText(payload) {
	return "_*<" + payload.repository.html_url + "|[" + payload.repository.full_name + "]>*_";
}