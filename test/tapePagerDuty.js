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
    request = require("request"),
    tiamUtils = require('./tiamTestUtils.js'),
    test = require('tape'),
    _ = require('underscore')
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

var event_endpoints = {};

var mockServiceInstanceId = "1234";
var mockToolchainId = "c234adsf-111";

var header = {};
var authenticationTokens = [];
var mockUserArray = [];

var currentTime = new Date().valueOf();
var pagerduty = {};
pagerduty.service_name = "testPagerDuty" + currentTime;
pagerduty.user_email = "user" + currentTime + "@ibm.com";
pagerduty.user_phone_country = '33';
pagerduty.user_phone_number = "123456789";
var pagerdutyAccountId = nconf.get("pagerduty-account");
var pagerdutyApiKey = nconf.get("pagerduty-api-key");
var pagerdutyApiUrl = "https://" + pagerdutyAccountId + '.' + nconf.get("services:pagerduty").substring("https://".length) + "/api/v1";

test('PagerDuty Broker - Test Setup', function (t) {
    mockUserArray = nconf.get('userArray');

    t.plan(mockUserArray.length * 2);

    for(var i = 0; i < mockUserArray.length; i++) (function(i) {
        tiamUtils.authenticateTestUserWithTIAM (function(accessToken) {
            tiamUtils.getProfile (accessToken, function(err, profile) {
                t.equal(err, null, 'Was authenticate test user with TIAM successful?');
                authenticationTokens[i] = accessToken;
                if(typeof authenticationTokens[0] !== 'undefined' && i === 0) {
                    header.Authorization = authenticationTokens[0];
                }
                t.pass('Authentication succeeded for mock user: ' + mockUserArray[i].testusername);
            });
        }, i);
    } (i));
});

//Authentication testing
test('PagerDuty Broker - Test Authentication', function (t) {
    t.plan(4);

    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId;
    var body = {
        'service_id': 'pagerduty',
        'organization_guid': nconf.get('test_app_org_guid')
    };
    var auth = {
        'Authorization': ''
    };

    putRequest(url, {header: null, body: JSON.stringify(body)})
        .then(function(resultNoHeader) {
            t.equal(resultNoHeader.statusCode, 401, 'did the authentication request with no Auth header fail?');

            putRequest(url, {header: auth, body: JSON.stringify(body)})
                .then(function(resultNoToken) {
                    t.equal(resultNoToken.statusCode, 401, 'did the authentication request with an empty Auth header fail?');
                });
                auth.Authorization = 'token';
                putRequest(url, {header: auth, body: JSON.stringify(body)})
                    .then(function(resultNoBearer) {
                        t.equal(resultNoBearer.statusCode, 401, 'did the authentication request with no bearer in the Auth header fail?');
                    });
                    auth.Authorization = 'BEARER token';
                    putRequest(url, {header: auth, body: JSON.stringify(body)})
                    .then(function(resultInvalidToken) {
                        t.equal(resultInvalidToken.statusCode, 401, 'did the authentication request an invalid token in the Auth header fail?');
                    });
    });
});

test('PagerDuty Broker - Test PUT instance', function (t) {
    t.plan(16);

    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId;
    var body = {};

    putRequest(url, {header: header, body: null})
        .then(function(resultNoBody) {
            t.equal(resultNoBody.statusCode, 400, 'did the put instance call with no body fail?');
            body.service_id = 'pagerduty';

            putRequest(url, {header: header, body: JSON.stringify(body)})
                .then(function(resultNoOrg) {
                    t.equal(resultNoOrg.statusCode, 400, 'did the put instance call with no service id fail?');
                    body.organization_guid = nconf.get('test_app_org_guid');
                    
                    body.parameters = getPostServiceInstanceParameters(pagerduty);
                    
                    //t.comment(pagerduty_service_name);
                    
                    putRequest(url, {header: header, body: JSON.stringify(body)})
                        .then(function(results) {
                            t.equal(results.statusCode, 200, 'did the put instance call succeed?');
                            t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
                            
                            // Ensure PagerDuty service and user have been created
                            assertServiceAndUser(pagerduty, t);
                            
                            // Ensure dashboard url is accessible
                            var dashboardUrl = results.body.dashboard_url;
                            getRequest(dashboardUrl, {}) .then(function(getResults) {
                                t.notEqual(getResults.statusCode, 404, 'did the get dashboard url call succeed?');
                            });
                        });
                });
    });
});

test('PagerDuty Broker - Test PUT instance with names being prefix of existing ones', function (t) {
    t.plan(15);
    
    var pagerduty2 = _.clone(pagerduty);
    pagerduty2.service_name += " 2 Suffix";
    pagerduty2.user_email = "user" + currentTime + "_2@ibm.com.suffix";

    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId;
    var body = {};
    body.service_id = 'pagerduty';
    body.organization_guid = nconf.get('test_app_org_guid');
    body.parameters = getPostServiceInstanceParameters(pagerduty2);;

    putRequest(url, {header: header, body: JSON.stringify(body)}).then(function(results) {
        t.equal(results.statusCode, 200, 'did the first put instance call succeed?');

        var pagerduty3 = _.clone(pagerduty);
        pagerduty3.service_name += " 2";
	    pagerduty3.user_email = "user" + currentTime + "_2@ibm.com";
	
	    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId;
	    body.parameters = getPostServiceInstanceParameters(pagerduty3);;
	
	    putRequest(url, {header: header, body: JSON.stringify(body)}).then(function(results) {
	        t.equal(results.statusCode, 200, 'did the second put instance call succeed?');
	        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
	        
	        // Ensure PagerDuty service and user have been created
	        assertServiceAndUser(pagerduty3, t);
	        
	        // Ensure dashboard url is accessible
	        var dashboardUrl = results.body.dashboard_url;
	        getRequest(dashboardUrl, {}) .then(function(getResults) {
	            t.notEqual(getResults.statusCode, 404, 'did the get dashboard url call succeed?');
	        });
	    });
    });
});

test('PagerDuty Broker - Test PUT instance reusing existing PagerDuty service', function (t) {
    t.plan(6);
    
    var pagerduty4 = _.clone(pagerduty);
    pagerduty4.service_name = "(4) " + pagerduty.service_name;
    pagerduty4.user_email = "user" + currentTime + "_4@ibm.com";

    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId;
    var body = {};
    body.service_id = 'pagerduty';
    body.organization_guid = nconf.get('test_app_org_guid');
    body.parameters = getPostServiceInstanceParameters(pagerduty4);;

    putRequest(url, {header: header, body: JSON.stringify(body)}).then(function(results) {
        t.equal(results.statusCode, 200, 'did the first put instance call succeed?');

        var pagerduty5 = {};
        pagerduty5.service_name = pagerduty4.service_name;	
	    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId;
	    body.parameters = getPostServiceInstanceParameters(pagerduty5);;
	
	    putRequest(url, {header: header, body: JSON.stringify(body)}).then(function(results) {
	        t.equal(results.statusCode, 200, 'did the second put instance call succeed?');
	        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
	        
	        // Ensure PagerDuty service is reused
	        assertService(pagerduty5, t, null);
	        
	        // Ensure dashboard url is accessible
	        var dashboardUrl = results.body.dashboard_url;
	        getRequest(dashboardUrl, {}) .then(function(getResults) {
	            t.notEqual(getResults.statusCode, 404, 'did the get dashboard url call succeed?');
	        });
	    });
    });
});

test('PagerDuty Broker - Test PATCH update instance with account_id and api_key', function (t) {
    t.plan(4);
	
    var pagerduty5 = _.clone(pagerduty);
    pagerduty5.service_name = "(5) " + pagerduty.service_name;
    pagerduty5.user_email = "user" + currentTime + "_5@ibm.com";

    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId + "_5";
    var body = {};
    body.service_id = 'pagerduty';
    body.organization_guid = nconf.get('test_app_org_guid');
    body.parameters = getPostServiceInstanceParameters(pagerduty5);;

    putRequest(url, {header: header, body: JSON.stringify(body)}).then(function(results) {
        t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
        
	    var body = {};
	    var pagerdutyAccountId2 = nconf.get("pagerduty-account-2");
	    var pagerdutyApiKey2 = nconf.get("pagerduty-api-key-2");
	    body.parameters = {
	    	"account_id": pagerdutyAccountId2,
	    	"api_key": pagerdutyApiKey2
	    };
	    
	    patchRequest(url, {header: header, body: JSON.stringify(body)})
	        .then(function(resultFromPatch) {
	            t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
	            t.equal(resultFromPatch.body.parameters.account_id, pagerdutyAccountId2, 'did the put instance call return the right account id?');
	            t.equal(resultFromPatch.body.parameters.api_key, pagerdutyApiKey2, 'did the put instance call return the right API key?');
	            // TODO: check that the service is created on new account
	    });   
    });
});

test('PagerDuty Broker - Test PATCH update service_name', function (t) {
    t.plan(2);
	
    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId;
    var body = {};
    var newServiceName = "(Updated) " + pagerduty.service_name;
    pagerduty.service_name = newServiceName; //update for next tests
    body.parameters = {
    	"service_name": newServiceName
    };
    
    patchRequest(url, {header: header, body: JSON.stringify(body)})
        .then(function(resultFromPatch) {
            t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
            t.equal(resultFromPatch.body.parameters.service_name, newServiceName, 'did the put instance call return the right service name?');
            // TODO: check that the service is created 
    });    				
});

test('PagerDuty Broker - Test PATCH update user_email', function (t) {
    t.plan(13);
	
    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId;
    var body = {};
    var newEmail = "user" + currentTime + ".updated@ibm.com";
    pagerduty.user_email = newEmail; //update for next tests
    body.parameters = {
    	"user_email": newEmail
    };
    
    patchRequest(url, {header: header, body: JSON.stringify(body)})
        .then(function(resultFromPatch) {
            t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
            t.equal(resultFromPatch.body.parameters.user_email, newEmail, 'did the put instance call return the right email?');
            var newPagerDuty = _.clone(pagerduty);
            newPagerDuty.user_email = newEmail;
            // check that the service is updated 
	        assertServiceAndUser(newPagerDuty, t);
    });    				
});

test('PagerDuty Broker - Test PATCH update user_phone', function (t) {
    t.plan(24);
	
    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId;
    var body = {};
    var newUserPhoneNumber = "987654321"
    var newPhone = "+" + pagerduty.user_phone_country + " " + newUserPhoneNumber;
    body.parameters = {
    	"user_phone": newPhone
    };
    
    patchRequest(url, {header: header, body: JSON.stringify(body)})
        .then(function(resultFromPatch) {
            t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
            t.equal(resultFromPatch.body.parameters.user_phone, newPhone, 'did the put instance call return the right phone?');
            var newPagerDuty = _.clone(pagerduty);
            newPagerDuty.user_phone_number = newUserPhoneNumber;
            // check that the service is updated 
	        assertServiceAndUser(newPagerDuty, t);
	        // check that the old phone number is still registered
	        assertServiceAndUser(pagerduty, t);
	});    				
});

test('PagerDuty Broker - Test PUT bind instance to toolchain', function (t) {
    t.plan(2);

    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId + '/toolchains/'+ mockToolchainId;
    putRequest(url, {header: header})
        .then(function(resultsFromBind) {
            t.equal(resultsFromBind.statusCode, 200, 'did the bind instance to toolchain call succeed?');
            //t.comment(JSON.stringify(resultsFromBind));
            if (_.isString(resultsFromBind.body.toolchain_lifecycle_webhook_url)) {
                t.ok(resultsFromBind.body.toolchain_lifecycle_webhook_url, 'did the toolchain_lifecycle_webhook_url value returned and valid ?');
                event_endpoints.toolchain_lifecycle_webhook_url = resultsFromBind.body.toolchain_lifecycle_webhook_url;
            } else {
                t.notOk(resultsFromBind.body.toolchain_lifecycle_webhook_url, 'is not a valid returned url for toolchain_lifecycle_webhook_url ?');            	
            }
    });
});

test('PagerDuty Broker - Test Messaging Store Like Event - AD start failed', function (t) {
	t.plan(1);
	
	// Message Store Event endpoint
	var messagingEndpoint = nconf.get('url') + '/pagerduty-broker/api/v1/messaging/accept';

	// Simulate a Pipeline event
	var message_store_pipeline_event = require("./active_deploy_start_job_failed");
	message_store_pipeline_event.toolchain_id = mockToolchainId;
	message_store_pipeline_event.instance_id = mockServiceInstanceId;
	
    postRequest(messagingEndpoint, {header: header, body: JSON.stringify(message_store_pipeline_event)})
        .then(function(resultFromPost) {
            t.equal(resultFromPost.statusCode, 204, 'did the message store like event sending call succeed?');
        });	
	
});

test('PagerDuty Broker - Test Messaging Store Like Event - AD finish failed', function (t) {
	t.plan(1);
	
	// Message Store Event endpoint
	var messagingEndpoint = nconf.get('url') + '/pagerduty-broker/api/v1/messaging/accept';

	// Simulate a Pipeline event
	var message_store_pipeline_event = require("./active_deploy_finish_job_failed");
	message_store_pipeline_event.toolchain_id = mockToolchainId;
	message_store_pipeline_event.instance_id = mockServiceInstanceId;
	
    postRequest(messagingEndpoint, {header: header, body: JSON.stringify(message_store_pipeline_event)})
        .then(function(resultFromPost) {
            t.equal(resultFromPost.statusCode, 204, 'did the message store like event sending call succeed?');
        });	
	
});

test('PagerDuty Broker - Test Messaging Store Like Event - Unknown service_id', function (t) {
	t.plan(1);
	
	// Message Store Event endpoint
	var messagingEndpoint = nconf.get('url') + '/pagerduty-broker/api/v1/messaging/accept';

	// Simulate a Pipeline event
	var message_store_pipeline_event = require("./active_deploy_start_job_failed");
	message_store_pipeline_event.toolchain_id = mockToolchainId;
	message_store_pipeline_event.instance_id = mockServiceInstanceId;
	message_store_pipeline_event.service_id = 'unknown';
	
    postRequest(messagingEndpoint, {header: header, body: JSON.stringify(message_store_pipeline_event)})
        .then(function(resultFromPost) {
            t.equal(resultFromPost.statusCode, 204, 'did the message store like event sending call succeed?');
        });	
	
});

test('PagerDuty Broker - Test Toolchain Lifecycle Like Event', function (t) {
	t.plan(1);
	
	var lifecycle_event = {"description" : "this a toolchain lifecycle event"};
	// Simulate a Toolchain Lifecycle event
    postRequest(event_endpoints.toolchain_lifecycle_webhook_url, {header: header, body: JSON.stringify(lifecycle_event)})
        .then(function(resultFromPost) {
            t.equal(resultFromPost.statusCode, 204, 'did the toolchain lifecycle event sending call succeed?');
        });	
	
});


//Monitoring endpoints
test('PagerDuty Broker - Test GET status', function (t) {
    t.plan(1);

    var url = nconf.get('url') + '/status';
    getRequest(url, {header: null}).then(function(results) {
    	t.equal(results.statusCode, 200, 'did the get status call succeed?');
    });
});

test('PagerDuty Broker - Test GET version', function (t) {
    t.plan(1);

    var url = nconf.get('url') + '/version';
    getRequest(url, {header: null})
        .then(function(results) {
            // Try to get the build number from the pipeline environment variables, otherwise the value is undefined.
            var buildID = process.env.BUILD_NUMBER;
            if(buildID) {
                t.equal(JSON.parse(results.body).build, buildID, 'did the get version call succeed?');
            } else {
                t.equal(results.statusCode, 200, 'did the get version call succeed?');
            }
    });
});

// Utility functions

function assertService(pagerduty, t, callback) {
	var pagerdutyHeaders = {
		'Authorization': 'Token token=' + pagerdutyApiKey
	};
	var url = pagerdutyApiUrl + "/services?query=" + encodeURIComponent(pagerduty.service_name) + "&include[]=escalation_policy";
	request.get({
		uri: url,
		json: true,
		headers: pagerdutyHeaders
	}, function(err, reqRes, body) {
        t.equal(reqRes.statusCode, 200, 'did the get service call succeed?');
    	var foundServices = _.where(body.services, {"name": pagerduty.service_name});
        t.equal(foundServices.length, 1, 'was exactly 1 service found?');
        var service = foundServices[0];
        if (callback)
        	return callback(pagerduty, t, pagerdutyHeaders, service);
        return;
	});
}

// plan == 11
function assertServiceAndUser(pagerduty, t) {
	assertService(pagerduty, t, function(pagerduty, t, pagerdutyHeaders, service) {
        var escalation_policy = service.escalation_policy;
        var userName = "Primary contact (" + pagerduty.user_email + ")";
        t.equal(escalation_policy.name, "Policy for " + pagerduty.service_name, 'was the right escalation policy created?');
        var escalation_policy_url = pagerdutyApiUrl + "/escalation_policies/" + escalation_policy.id;
    	request.get({
    		uri: escalation_policy_url,
    		json: true,
    		headers: pagerdutyHeaders
    	}, function(err, reqRes, body) {
			t.equal(reqRes.statusCode, 200, 'did the get escalation policy call succeed?');
			t.equal(body.escalation_policy.escalation_rules.length, 1, 'was only 1 escalation rule found?');
			var escalation_rule = body.escalation_policy.escalation_rules[0];
			t.equal(escalation_rule.targets.length, 1, 'was only 1 target user found?');
			var target = escalation_rule.targets[0];
			t.equal(target.name, userName, 'was the correct user name used?');
			t.equal(target.email, pagerduty.user_email, 'was the correct user email used?');
			var contact_method_url = pagerdutyApiUrl + "/users/" + target.id + "/contact_methods";
			request.get({
				uri: contact_method_url,
				json: true,
				headers: pagerdutyHeaders
			}, function(err, reqRes, body) {
				t.equal(reqRes.statusCode, 200, 'did the get contact methods call succeed?');
				t.ok(body.contact_methods, 'were contact methods found?');
				var contact_method = _.findWhere(body.contact_methods, {"type": "phone", "country_code": Number(pagerduty.user_phone_country), "phone_number": pagerduty.user_phone_number});
				t.ok(contact_method, 'was the phone contact method found (+' + pagerduty.user_phone_country + ' ' + pagerduty.user_phone_number + ')?');
			});
    	});
        
	});
}

function getPostServiceInstanceParameters(pagerduty) {
	var user_phone;
	if (pagerduty.user_phone_country) {
		user_phone = "+" + pagerduty.user_phone_country + " " + pagerduty.user_phone_number;
	} else if (pagerduty.user_phone_number)
		user_phone = pagerduty.user_phone_number;
	return {
		account_id: pagerdutyAccountId,
		api_key: pagerdutyApiKey,
		service_name: pagerduty.service_name,
		user_email: pagerduty.user_email,
		user_phone: user_phone
	};
}

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

function patchRequest(url, options) {
    var params = initializeRequestParams(url, options);

    var patch = Q.nbind(request.patch, this);
    return patch(params.uri, {body: params.body, headers: params.headers})
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

function postRequest(url, options) {
    var params = initializeRequestParams(url, options);

    var post = Q.nbind(request.post, this);
    return post(params.uri, {body: params.body, headers: params.headers})
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
