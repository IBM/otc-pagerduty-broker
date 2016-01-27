/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015, 2016. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
"use strict";

var _ = require("underscore");

// For now, convert Active Deploy job failure only
module.exports = function(event) {
	// Paranoia start
	if (!event || !event.execution) 
		return null;
	var execution = event.execution;
	if (execution.successful)
		return null;
	if (!execution.jobExecutions)
		return null;
	if (!event.stage)
		return null;
	var stage = event.stage;
	if (!stage.jobs)
		return null;
	if (!stage.name)
		return null;
	// Paranoia end
	
	var failedJobs = _.where(execution.jobExecutions, {"successful": false});
	if (!failedJobs)
		return null;
	for (var i = 0; i < failedJobs.length; i++) {
		var failedJob = failedJobs[i];
		var activeDeployJob = _.findWhere(stage.jobs, {
			"buildType": "extension", 
			"extensionId": "ibm.devops.services.pipeline.devops.ad_finish", 
			"id": failedJob.jobId
		});
		if (activeDeployJob)
			return stage.name + " FAILED"; // TODO: include url to pipeline
	}
	return null;
}
