/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015, 2016. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
"use strict";

// Currently, don't do anything with events coming from toolchain
module.exports = function(toolchainId, event, toolchainCredentials, callback) {
	callback(null, null);
}