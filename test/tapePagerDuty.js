/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015, 2015. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
var nconf = require('nconf'),
    request = require("request"),
    path = require('path'),
    Q = require('q'),
    tiamUtils = require('./tiamTestUtils.js'),
    test = require('tape')
;

nconf.env("__");

if (process.env.NODE_ENV) {
    nconf.file('node_env', 'config/' + process.env.NODE_ENV + '.json');
}
nconf.file('test', path.join(__dirname, '..', 'config', 'dev.json'));

// Load in the user information.
nconf.file('testUtils', path.join(__dirname, '..', 'config', 'testUtils.json'));

var header = {
    authorization: "Basic Y2Y6",
    accept: "application/json"
};

var defaultHeaders = {
    'Accept': 'application/json,text/json',
    'Content-Type': 'application/json'
};

var mockServiceInstanceId = "1234";
var mockToolchainId = "c234adsf-111";

var header = {};
var authenticationTokens = [];
var mockUserArray = [];

// TODO


// Utility functions

function initializeRequestParams(url, options) {

    var outputObject = {};
    outputObject.headers = JSON.parse(JSON.stringify(defaultHeaders)); //clone without reference

    var header = options.header;

    for(var key in header)  {
        outputObject.headers[key] = header[key];
    }

    if (options.body !== null)    {

        outputObject.json = true;

        outputObject.body = options.body;
    }

    var params = request.initParams(url, outputObject);
    return params;
}

function delRequest(url, options) {
    var params = initializeRequestParams(url, options);

    var del = Q.nbind(request.del, this);
    return del(params.uri, {headers: params.headers})
        .then(function(res) {
            if(res[1]) {
                   return {
                    "statusCode": res[0].statusCode,
                    "body": JSON.parse(res[1])
                };
            } else {
                return {
                    "statusCode": res[0].statusCode
                };
            }
        });
}

function getRequest(url, options) {
    var params = initializeRequestParams(url, options);

    var get = Q.nbind(request.get, this);
    return get(params.uri, {headers: params.headers})
        .then(function(res) {
            if(res[1]) {
                // The /status endpoint doesn't return JSON so
                // the body isn't parsed.
                return {
                    "statusCode": res[0].statusCode,
                    "body": res[1]
                };
            } else {
                return {
                    "statusCode": res[0].statusCode
                };
            }
        });
}

function putRequest(url, options) {
    var params = initializeRequestParams(url, options);

    var put = Q.nbind(request.put, this);
    return put(params.uri, {body: params.body, headers: params.headers})
        .then(function(res) {
            if(res[1]) {
                   return {
                    "statusCode": res[0].statusCode,
                    "body": JSON.parse(res[1])
                };
            } else {
                return {
                    "statusCode": res[0].statusCode
                };
            }
        });
}
