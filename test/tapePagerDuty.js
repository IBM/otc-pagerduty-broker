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
    async = require("async"),
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
var serviceInstanceUrl = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId;


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

var testNumber = 0;

test(++testNumber + ' PagerDuty Broker - Test Setup', function (t) {
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
test(++testNumber + ' PagerDuty Broker - Test Authentication', function (t) {
    t.plan(4);

    var body = {
        'service_id': 'pagerduty',
        'organization_guid': nconf.get('test_app_org_guid')
    };
    var auth = {
        'Authorization': ''
    };

	async.series([
		function(callback) {
			// no header
			putRequest(serviceInstanceUrl, {header: null, body: JSON.stringify(body)}).then(function(resultNoHeader) {
				t.equal(resultNoHeader.statusCode, 401, 'did the authentication request with no Auth header fail?');
				callback();
			});
		},
		function(callback) {
			// empty header
			putRequest(serviceInstanceUrl, {header: auth, body: JSON.stringify(body)}).then(function(resultEmptyHeader) {
                t.equal(resultEmptyHeader.statusCode, 401, 'did the authentication request with an empty Auth header fail?');
				callback();
			});
		},
		function(callback) {
			// no bearer token
            auth.Authorization = 'token';
            putRequest(serviceInstanceUrl, {header: auth, body: JSON.stringify(body)}).then(function(resultNoBearer) {
				t.equal(resultNoBearer.statusCode, 401, 'did the authentication request with no bearer in the Auth header fail?');
				callback();
			});
		},
		function(callback) {
			// invalid bearer token
            auth.Authorization = 'BEARER token';
            putRequest(serviceInstanceUrl, {header: auth, body: JSON.stringify(body)}).then(function(resultInvalidToken) {
                t.equal(resultInvalidToken.statusCode, 401, 'did the authentication request an invalid token in the Auth header fail?');
				callback();
			});
		}
	], function(err, results) {
   		if (err) {
   			t.fail(err);
   		}
	});
});

test(++testNumber + ' PagerDuty Broker - Test PUT instance with wrong parameters', function (t) {
    t.plan(6);

    var body = {};
    
    async.series([
       function(callback) {
    	   // no body
    	    putRequest(serviceInstanceUrl, {header: header, body: null}).then(function(resultNoBody) {
                t.equal(resultNoBody.statusCode, 400, 'did the put instance call with no body fail?');
                callback();
            });
       },
       function (callback) {
    	   // no organization_guid
           body.service_id = 'pagerduty';
           putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(resultNoOrg) {
                t.equal(resultNoOrg.statusCode, 400, 'did the put instance call with no organization_guid fail?');
                callback();
           });    	   
       }, 
       function (callback) {
    	   // wrong api_key
           body.organization_guid = nconf.get('test_app_org_guid');
           body.parameters = getPostServiceInstanceParameters(pagerduty);
           body.parameters.api_key = "wrong" + body.parameters.api_key; 
           putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(results) {
               t.equal(results.statusCode, 400, 'did the put instance with wrong api_key failed?');
               callback();
           });    	   
       },
       function (callback) {
    	   // wrong account_id
           body.parameters = getPostServiceInstanceParameters(pagerduty);
           body.parameters.account_id = "wrong" + body.parameters.account_id; 
           putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(results) {
               t.equal(results.statusCode, 400, 'did the put instance with wrong account_id failed?');
               callback();
           });    	   
       },
       function (callback) {
    	   // wrong email
           body.parameters = getPostServiceInstanceParameters(pagerduty);
           body.parameters.user_email = "test@gmail"; 
           putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(results) {
               t.equal(results.statusCode, 400, 'did the put instance with wrong email failed?');
               callback();
           });    	   
       },
       function (callback) {
    	   // wrong phone number
           body.parameters = getPostServiceInstanceParameters(pagerduty);
           body.parameters.user_phone = "0123"; 
           putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(results) {
               t.equal(results.statusCode, 400, 'did the put instance with wrong phone failed?');
               callback();
           });    	   
       }
    ], function(err, results) {
    	if (err) {
    		t.fail(err);
    	}
    });
});


test(++testNumber + ' PagerDuty Broker - Test PUT instance', function (t) {
    t.plan(19);

    var body = getNewInstanceBody(pagerduty);
    putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(results) {
        t.equal(results.statusCode, 200, 'did the put instance call succeed?');
        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
        
        // Ensure PagerDuty service and user have been created
        assertServiceAndUser(pagerduty, t);
        
        // Ensure dashboard url is accessible
        assertDashboardAccessible(results.body, t);
    });
});

test(++testNumber + ' PagerDuty Broker - Test PUT instance with names being prefix of existing ones', function (t) {
    t.plan(20);
    
	async.series([
		function(callback) {
			// instance with suffix names
		    var pagerduty2 = _.clone(pagerduty);
		    pagerduty2.service_name = getTestServiceName() + " Suffix";
		    pagerduty2.user_email = getTestUserEmail() + ".suffix";
    		var body = getNewInstanceBody(pagerduty2);
			putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// instance with prefix names
			var pagerduty3 = _.clone(pagerduty);
	        pagerduty3.service_name = getTestServiceName();
		    pagerduty3.user_email = getTestUserEmail();
		    var body = getNewInstanceBody(pagerduty3);
		    putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(results) {
		        t.equal(results.statusCode, 200, 'did the second put instance call succeed?');
		        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
		        
		        // Ensure PagerDuty service and user have been created
		        assertServiceAndUser(pagerduty3, t);
		        
		        // Ensure dashboard url is accessible
		        assertDashboardAccessible(results.body, t);
		        
				callback();
			});
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test(++testNumber + ' PagerDuty Broker - Test PUT instance reusing existing PagerDuty service', function (t) {
    t.plan(6);
    
    var pagerduty2 = _.clone(pagerduty);
    pagerduty2.service_name = getTestServiceName();
    pagerduty2.user_email = getTestUserEmail();
	async.series([
		function(callback) {
			// first instance
    		var body = getNewInstanceBody(pagerduty2);
			putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// second instance reuse service of first instance
	        var pagerduty3 = {};
	        pagerduty3.service_name = pagerduty2.service_name;	
		    var body = getNewInstanceBody(pagerduty3);
		    putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(results) {
		        t.equal(results.statusCode, 200, 'did the second put instance call succeed?');
		        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
		        
		        // Ensure PagerDuty service is reused
		        assertService(pagerduty3, t, null);
		        
		        // Ensure dashboard url is accessible
		        assertDashboardAccessible(results.body, t);
		         
		        callback();
			});
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test(++testNumber + ' PagerDuty Broker - Test PUT instance missing phone number', function (t) {
    t.plan(12);
    
    var pagerduty2 = _.clone(pagerduty);
    pagerduty2.service_name = getTestServiceName();
    pagerduty2.user_email = getTestUserEmail();
    delete pagerduty2.user_phone_country;
    delete pagerduty2.user_phone_number;

    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
	var body = getNewInstanceBody(pagerduty2);
    putRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(results) {
        t.equal(results.statusCode, 200, 'did the put instance call succeed?');
        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
        
        // Ensure PagerDuty service and user have been created
        assertServiceAndUser(pagerduty2, t);
    });
});

test(++testNumber + ' PagerDuty Broker - Test PUT instance missing email', function (t) {
    t.plan(1);
    
    var pagerduty2 = _.clone(pagerduty);
    pagerduty2.service_name = getTestServiceName();
    delete pagerduty2.user_email;

    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
    var body = getNewInstanceBody(pagerduty2);
    putRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(results) {
        t.equal(results.statusCode, 400, 'did the put instance call fail with a bad request?');
    });
});

// Patch tests
test(++testNumber + ' PagerDuty Broker - Test PATCH update instance with account_id and api_key', function (t) {
    t.plan(20);
	
    var pagerduty2 = _.clone(pagerduty);
    pagerduty2.service_name = getTestServiceName();
    pagerduty2.user_email = getTestUserEmail();
    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
 	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(pagerduty2);
			putRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// patch account_id and api_key
		    var body = {};
		    var pagerdutyAccountId2 = nconf.get("pagerduty-account-2");
		    var pagerdutyApiKey2 = nconf.get("pagerduty-api-key-2");
		    body.parameters = {
		    	"account_id": pagerdutyAccountId2,
		    	"api_key": pagerdutyApiKey2
		    };
		    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
		        t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
	            t.equal(resultFromPatch.body.parameters.account_id, pagerdutyAccountId2, 'did the put instance call return the right account id?');
	            t.equal(resultFromPatch.body.parameters.api_key, pagerdutyApiKey2, 'did the put instance call return the right API key?');
		        // check that the service is created on new account
		        pagerduty2.account_id = pagerdutyAccountId2;
		        pagerduty2.api_key = pagerdutyApiKey2;
		        var apiUrl2 = "https://" + pagerdutyAccountId2 + '.' + nconf.get("services:pagerduty").substring("https://".length) + "/api/v1";
		        assertServiceAndUserOnAccount(apiUrl2, pagerdutyApiKey2, pagerduty2, t);
		        callback();
		    });    
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test(++testNumber + ' PagerDuty Broker - Test PATCH wrong api_key', function (t) {
    t.plan(1);
	
    var body = {};
    body.parameters = {
    	"api_key": "wrong"
    };
    
    patchRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
		t.equal(resultFromPatch.statusCode, 400, 'did the patch instance call with wrong api_key failed?');
    });    				
});

test(++testNumber + ' PagerDuty Broker - Test PATCH with invalid account_id', function (t) {
    t.plan(2);
	
    var body = {};
    var newAccountId = "http://ibm.com";
    body.parameters = {
    	"account_id": newAccountId
    };
    
    patchRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
        t.equal(resultFromPatch.statusCode, 400, 'did the patch instance call return a bad request?');
        t.equal(resultFromPatch.body.description, "Invalid account_id: " + newAccountId, 'is the bad request message correct?');
    });    				
});


test(++testNumber + ' PagerDuty Broker - Test PATCH update service_name', function (t) {
    t.plan(19);
	
    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
    var pagerduty2 = _.clone(pagerduty);
    pagerduty2.service_name = getTestServiceName();
    pagerduty2.user_email = getTestUserEmail();
	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(pagerduty2);
			putRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// patch service_name
		    var body = {};
		    var newServiceName = "(Updated) " + pagerduty2.service_name;
		    body.parameters = {
		    	"service_name": newServiceName
		    };
		    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
		        t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
		        t.equal(resultFromPatch.body.parameters.service_name, newServiceName, 'did the patch instance call return the right service name?');
				// check that the service is created
				pagerduty2.service_name = newServiceName;
		        assertServiceAndUser(pagerduty2, t);
		        callback();
		    });    
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test(++testNumber + ' PagerDuty Broker - Test PATCH update user_email', function (t) {
    t.plan(19);
	
    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
    var pagerduty2 = _.clone(pagerduty);
    pagerduty2.service_name = getTestServiceName();
    pagerduty2.user_email = getTestUserEmail();
	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(pagerduty2);
			putRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// patch user_email
		    var body = {};
		    var newEmail = "user" + currentTime + ".updated@ibm.com";
		    body.parameters = {
		    	"user_email": newEmail
		    };
		    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
		        t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
     			t.equal(resultFromPatch.body.parameters.user_email, newEmail, 'did the patch instance call return the right email?');
				// check that the service is updated
				pagerduty2.user_email = newEmail;
		        assertServiceAndUser(pagerduty2, t);
		        callback();
		    });    
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test(++testNumber + ' PagerDuty Broker - Test PATCH update user_phone', function (t) {
    t.plan(35);
	
    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
    var pagerduty2 = _.clone(pagerduty);
    pagerduty2.service_name = getTestServiceName();
    pagerduty2.user_email = getTestUserEmail();
	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(pagerduty2);
			putRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// patch user_phone
		    var body = {};
		    var newUserPhoneNumber = "987654321"
		    var newPhone = "+" + pagerduty.user_phone_country + " " + newUserPhoneNumber;
		    body.parameters = {
		    	"user_phone": newPhone
		    };
		    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
		        t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
     			t.equal(resultFromPatch.body.parameters.user_phone, newPhone, 'did the patch instance call return the right phone?');
		        // check that the old phone number is still registered
		        assertServiceAndUser(pagerduty2, t);
		        // check that the new phone number is registered 
		        pagerduty2.user_phone_number = newUserPhoneNumber;
		        assertServiceAndUser(pagerduty2, t);
		        callback();
		    });    
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

// Bind tests
test(++testNumber + ' PagerDuty Broker - Test PUT bind instance to toolchain', function (t) {
    t.plan(2);

    var toolchainUrl = serviceInstanceUrl + '/toolchains/'+ mockToolchainId;
    putRequest(toolchainUrl, {header: header}).then(function(resultsFromBind) {
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

// Events tests
test(++testNumber + ' PagerDuty Broker - Test Messaging Store Like Event - AD start failed', function (t) {
	t.plan(1);
	
	// Message Store Event endpoint
	var messagingEndpoint = nconf.get('url') + '/pagerduty-broker/api/v1/messaging/accept';

	// Simulate a Pipeline event
	var message_store_pipeline_event = require("./active_deploy_start_job_failed");
	message_store_pipeline_event.toolchain_id = mockToolchainId;
	message_store_pipeline_event.instance_id = mockServiceInstanceId;
	
    postRequest(messagingEndpoint, {header: header, body: JSON.stringify(message_store_pipeline_event)}).then(function(resultFromPost) {
        t.equal(resultFromPost.statusCode, 204, 'did the message store like event sending call succeed?');
    });	
	
});

test(++testNumber + ' PagerDuty Broker - Test Messaging Store Like Event - AD finish failed', function (t) {
	t.plan(1);
	
	// Message Store Event endpoint
	var messagingEndpoint = nconf.get('url') + '/pagerduty-broker/api/v1/messaging/accept';

	// Simulate a Pipeline event
	var message_store_pipeline_event = require("./active_deploy_finish_job_failed");
	message_store_pipeline_event.toolchain_id = mockToolchainId;
	message_store_pipeline_event.instance_id = mockServiceInstanceId;
	
    postRequest(messagingEndpoint, {header: header, body: JSON.stringify(message_store_pipeline_event)}).then(function(resultFromPost) {
        t.equal(resultFromPost.statusCode, 204, 'did the message store like event sending call succeed?');
    });	
	
});

test(++testNumber + ' PagerDuty Broker - Test Messaging Store Like Event - Unknown service_id', function (t) {
	t.plan(1);
	
	// Message Store Event endpoint
	var messagingEndpoint = nconf.get('url') + '/pagerduty-broker/api/v1/messaging/accept';

	// Simulate a Pipeline event
	var message_store_pipeline_event = require("./active_deploy_start_job_failed");
	message_store_pipeline_event.toolchain_id = mockToolchainId;
	message_store_pipeline_event.instance_id = mockServiceInstanceId;
	message_store_pipeline_event.service_id = 'unknown';
	
    postRequest(messagingEndpoint, {header: header, body: JSON.stringify(message_store_pipeline_event)}).then(function(resultFromPost) {
        t.equal(resultFromPost.statusCode, 204, 'did the message store like event sending call succeed?');
    });	
	
});

test(++testNumber + ' PagerDuty Broker - Test Toolchain Lifecycle Like Event', function (t) {
	t.plan(1);
	
	var lifecycle_event = {"description" : "this a toolchain lifecycle event"};
	// Simulate a Toolchain Lifecycle event
    postRequest(event_endpoints.toolchain_lifecycle_webhook_url, {header: header, body: JSON.stringify(lifecycle_event)}).then(function(resultFromPost) {
        t.equal(resultFromPost.statusCode, 204, 'did the toolchain lifecycle event sending call succeed?');
    });	
	
});

//Delete tests
test(++testNumber + ' PagerDuty Broker - Test DELETE instance w/ other org', function (t) {
    t.plan(1);
    var otherAuth = {
        'Authorization': authenticationTokens[1]
    };
    delRequest(serviceInstanceUrl, {header: otherAuth}).then(function(resultsFromDel) {
		t.equal(resultsFromDel.statusCode, 403, 'did the instance with other org fail to delete?');
    });
});

test(++testNumber + ' PagerDuty Broker - Test DELETE instance', function (t) {
    t.plan(1);

    delRequest(serviceInstanceUrl, {header: header}).then(function(resultsFromDel) {
		t.equal(resultsFromDel.statusCode, 204, 'did the delete instance call succeed?');
    });
});

// Unbind tests, the service instance will still remain in the DB
test(++testNumber + ' PagerDuty Broker - Test DELETE unbind instance from toolchain w/ other org', function (t) {
    t.plan(5);

    var otherAuth = {
        'Authorization': authenticationTokens[1]
    };
    var body = getNewInstanceBody(pagerduty);
    putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(results) {
        t.equal(results.statusCode, 200, 'did the put instance call succeed?');
        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');

        putRequest(serviceInstanceUrl + '/toolchains/'+ mockToolchainId, {header: header})
            .then(function(resultsFromBind) {
                t.equal(resultsFromBind.statusCode, 200, 'did the bind instance to toolchain call succeed?');

                delRequest(serviceInstanceUrl + '/toolchains/'+ mockToolchainId, {header: otherAuth})
                    .then(function(resultsFromDel) {
                        t.equal(resultsFromDel.statusCode, 403, 'did the unbind instance call with other org fail?');

                        delRequest(serviceInstanceUrl, {header: header})
                            .then(function(resultsFromDel) {
                                t.equal(resultsFromDel.statusCode, 204, 'did the delete instance call succeed?');
                        });
                });
        });
    });
});


test(++testNumber + ' PagerDuty Broker - Test DELETE unbind instance from toolchain', function (t) {
    t.plan(5);

    var body = getNewInstanceBody(pagerduty);
    putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)})
        .then(function(resultFromPut) {
            t.equal(resultFromPut.statusCode, 200, 'did the put instance call succeed?');
            t.ok(resultFromPut.body.instance_id, 'did the put instance call return an instance_id?');

            putRequest(serviceInstanceUrl + '/toolchains/'+ mockToolchainId, {header: header})
                .then(function(resultsFromBind) {
                    t.equal(resultsFromBind.statusCode, 200, 'did the bind instance to toolchain call succeed?');

                    delRequest(serviceInstanceUrl + '/toolchains/'+ mockToolchainId, {header: header})
                        .then(function(resultsFromDel) {
                            t.equal(resultsFromDel.statusCode, 204, 'did the unbind instance call succeed?');

                            delRequest(serviceInstanceUrl, {header: header})
                                .then(function(resultsFromDel) {
                                    t.equal(resultsFromDel.statusCode, 204, 'did the delete instance call succeed?');
                            });
                    });
            });
    });
});

//Monitoring endpoints
test(++testNumber + ' PagerDuty Broker - Test GET status', function (t) {
    t.plan(1);

    var url = nconf.get('url') + '/status';
    getRequest(url, {header: null}).then(function(results) {
    	t.equal(results.statusCode, 200, 'did the get status call succeed?');
    });
});

test(++testNumber + ' PagerDuty Broker - Test GET version', function (t) {
    t.plan(1);

    var url = nconf.get('url') + '/version';
    getRequest(url, {header: null}).then(function(results) {
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

function assertDashboardAccessible(body, t) {
	var dashboardUrl = body.dashboard_url;
	request.get({
		uri: dashboardUrl,
		json: true,
		headers: {}
	}, function(err, reqRes, body) {
		t.notEqual(reqRes.statusCode, 404, 'did the get dashboard url call succeed?');
		return;
	});
}

function assertService(pagerduty, t, callback) {
	return assertServiceOnAccount(pagerdutyApiUrl, pagerdutyApiKey, pagerduty, t, callback);
}

function assertServiceOnAccount(apiUrl, apiKey, pagerduty, t, callback) {
	var pagerdutyHeaders = {
		'Authorization': 'Token token=' + apiKey
	};
	var url = apiUrl + "/services?query=" + encodeURIComponent(pagerduty.service_name) + "&include[]=escalation_policy";
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


// plan == 15 (or 10 for no phone number case)
function assertServiceAndUser(pagerduty, t) {
	return assertServiceAndUserOnAccount(pagerdutyApiUrl, pagerdutyApiKey, pagerduty, t);
}

function assertServiceAndUserOnAccount(apiUrl, apiKey, pagerduty, t) {
	assertServiceOnAccount(apiUrl, apiKey, pagerduty, t, function(pagerduty, t, pagerdutyHeaders, service) {
        var escalation_policy = service.escalation_policy;
        var userName = "Primary contact (" + pagerduty.user_email + ")";
        t.equal(escalation_policy.name, "Policy for " + pagerduty.service_name, 'was the right escalation policy created?');
        var escalation_policy_url = apiUrl + "/escalation_policies/" + escalation_policy.id;
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
			var contact_method_url = apiUrl + "/users/" + target.id + "/contact_methods";
			request.get({
				uri: contact_method_url,
				json: true,
				headers: pagerdutyHeaders
			}, function(err, reqRes, body) {
				t.equal(reqRes.statusCode, 200, 'did the get contact methods call succeed?');
				t.ok(body.contact_methods, 'were contact methods found?');
				if (!pagerduty.user_phone_number) // case where no phone number was provided
					return;
				var phone_contact_method = _.findWhere(body.contact_methods, {"type": "phone", "country_code": Number(pagerduty.user_phone_country), "phone_number": pagerduty.user_phone_number});
				t.ok(phone_contact_method, 'was the phone contact method found (+' + pagerduty.user_phone_country + ' ' + pagerduty.user_phone_number + ')?');
				var sms_contact_method = _.findWhere(body.contact_methods, {"type": "SMS", "country_code": Number(pagerduty.user_phone_country), "phone_number": pagerduty.user_phone_number});
				t.ok(sms_contact_method, 'was the SMS contact method found (+' + pagerduty.user_phone_country + ' ' + pagerduty.user_phone_number + ')?');
				
				// Check the notification rules for SMS and Phone
				var notification_rules_url = apiUrl + "/users/" + target.id + "/notification_rules";
				request.get({
					uri: notification_rules_url,
					json: true,
					headers: pagerdutyHeaders
				}, function(err, reqRes, body) {
					t.equal(reqRes.statusCode, 200, 'did the get notification rules call succeed?');
					t.ok(body.notification_rules, 'were notification rules found?');
					var phone_rule;
					var sms_rule;
					if (body.notification_rules) {
						_.each(body.notification_rules, function(notificationRule) {
							var contact_method = notificationRule.contact_method;
							if (contact_method) {
								if (contact_method.country_code==Number(pagerduty.user_phone_country) && contact_method.phone_number==pagerduty.user_phone_number) {
									if (contact_method.type=="SMS") {
										sms_rule = notificationRule;
									} else if (contact_method.type=="phone")
										phone_rule = notificationRule;
								}
							}						
						});
					}
					t.ok(phone_rule, 'was the Phone Notification rule found (+' + pagerduty.user_phone_country + ' ' + pagerduty.user_phone_number + ')?');					
					t.ok(sms_rule, 'was the SMS Notification rule found (+' + pagerduty.user_phone_country + ' ' + pagerduty.user_phone_number + ')?');
				});
				
			});
    	});
        
	});
}

function getNewInstanceBody(pagerduty) {
	var body = {};
    body.service_id = 'pagerduty';
    body.organization_guid = nconf.get('test_app_org_guid');
    body.parameters = getPostServiceInstanceParameters(pagerduty);
	return body;
}

function getTestUserEmail() {
	return "user" + currentTime + "_" + testNumber + "@ibm.com";
}

function getTestServiceName() {
	return "(" + testNumber + ") " + pagerduty.service_name;
}

function getPostServiceInstanceParameters(pagerduty) {
	var user_phone;
	if (pagerduty.user_phone_country) {
		user_phone = "+" + pagerduty.user_phone_country + " " + pagerduty.user_phone_number;
	} else if (pagerduty.user_phone_number)
		user_phone = pagerduty.user_phone_number;
	var result = {
		account_id: pagerdutyAccountId,
		api_key: pagerdutyApiKey,
		service_name: pagerduty.service_name
	};
	if (pagerduty.user_email)
		result.user_email = pagerduty.user_email;
	if (user_phone)
		result.user_phone = user_phone;
	return result;
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
