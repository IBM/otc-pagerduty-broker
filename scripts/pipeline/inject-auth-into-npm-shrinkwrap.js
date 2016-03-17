/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015, 2015. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
 
// Copied from /otc-deploy/cf-apps/common/inject-auth-into-npm-shrinkwrap.js

/*
 * Usage:
 *
 * Rich man's sed script for safely replacing username and password in npm-shrinkwrap.json
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
var util = require("util");
var targetFile = "npm-shrinkwrap.json";

var npmShrinkwrap = JSON.parse(fs.readFileSync(targetFile));
var deps = npmShrinkwrap;
injectGitCredsIntoDeps(deps);
fs.writeFileSync(targetFile, JSON.stringify(npmShrinkwrap, null, 2));


function injectGitCredsIntoDeps(npmShrinkwrap) {
    if (npmShrinkwrap.dependencies) {
	Object.getOwnPropertyNames(npmShrinkwrap.dependencies).forEach(function (dependency) {
	    injectGitCredsIntoDeps(npmShrinkwrap.dependencies[dependency]);
	});
    }

    if (npmShrinkwrap.from) {
	npmShrinkwrap.from = injectGitCredsIntoURL(npmShrinkwrap.from);
    }

    if (npmShrinkwrap.resolved) {
	npmShrinkwrap.resolved = injectGitCredsIntoURL(npmShrinkwrap.resolved);
    }
}

function injectGitCredsIntoURL(link) {
    if (!link.match(/^git\+https/)) {
	return link;
    }

    var urlObj = url.parse(link);

    if (urlObj.host !== "github.ibm.com") {
	return link;
    }

    urlObj.auth = util.format("%s:%s", process.env.IDS_USER, process.env.IDS_PASS);

    return url.format(urlObj);
}
