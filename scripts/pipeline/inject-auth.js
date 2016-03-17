/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015, 2015. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
 
// Copied from /otc-deploy/cf-apps/common/inject-auth.js

/*
 * Usage:
 *
 * Rich man's sed script for safely replacing username and password in package.json.
 *
 * export IDS_USER=cntaylor
 * export IDS_PASS=mypassword
 *
 * node ids_npm_install.js
 *
 */

"use strict";

var url = require("url");
var fs = require("fs");
var packageJSON = JSON.parse(fs.readFileSync("package.json"));
var deps = packageJSON.dependencies;

if (deps) {
	var isModified;

	Object.getOwnPropertyNames(deps).forEach(function (d) {
		var version = deps[d];

		// Version numbers don't apply.  Only URLs should be touched.
		if (!version.match(/^git\+https/))
			return;

		var urlObj = url.parse(deps[d]);

		// Leave URLs that aren't URLs to IDS repos.
		if (urlObj.host !== "github.ibm.com")
			return;

		urlObj.auth = urlObj.auth ? urlObj.auth : "";

		var auth = urlObj.auth.split(":");

		// Replace the username and/or password portions based on the envvars.
		if (process.env.IDS_USER && auth[0] !== process.env.IDS_USER) {
			isModified = true;
			auth[0] = process.env.IDS_USER;
		}
		if (process.env.IDS_PASS && auth[1] !== process.env.IDS_PASS) {
			isModified = true;
			auth[1] = process.env.IDS_PASS;
		}

		// We only want to write the file if we made changes.
		if (!isModified)
			return;

		// Add the modified auth blob to the parsed URL.
		urlObj.auth = auth.join(":");

		deps[d] = url.format(urlObj);
	});

	if (isModified) {
		fs.writeFileSync("package.json", JSON.stringify(packageJSON, null, " "));
	}
}
