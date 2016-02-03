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
	if (!event || !event.execution) 
		return null;
	var execution = event.execution;
	if (execution.successful)
		return null;
	if (event.event != "jobCompleted")
		return null;
	var job = event.job;
	if (!job || !job.extensionId)
		return null;
	if (!job.extensionId == "ibm.devops.services.pipeline.devops.ad_start"
			|| !job.extensionId == "ibm.devops.services.pipeline.devops.ad_finish")
		return null;
	if (!job.componentName)
		return null;
	return "Job '" + job.componentName + "' failed"; // TODO: include url to job
}
