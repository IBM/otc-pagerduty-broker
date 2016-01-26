/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015, 2016. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
"use strict";

module.exports = function(event) {
	if (!event || !event.execution) 
		return null;
	if (!event.execution.successful) {
		if (event.job && event.job.componentName) {
			return event.job.componentName + " failed";
		}
	}
	return null;
}
