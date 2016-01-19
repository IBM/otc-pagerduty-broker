/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
"use strict";

var
 log4js = require("log4js"),
 nanoDocUpdater = require("nano-doc-updater"),
 nconf = require("nconf"),
 request = require("request"),
 _ = require("underscore")
;

var logger = log4js.getLogger("otc-pagerduty-broker"),
 	logBasePath = "lib.middleware.pagerduty-utils";

module.exports.getOrCreatePagerDutyUser = getOrCreatePagerDutyUser;
module.exports.getOrCreateEscalationPolicy = getOrCreateEscalationPolicy;
module.exports.getOrCreatePagerDutyService = getOrCreatePagerDutyService;

function getErrorMessageFromResult(reqRes) {
	if (reqRes.body) {
		var message = geErrorMessageFromError(reqRes.body);
		if (message)
			return message;
	} 
	return reqRes.statusMessage;
}

function geErrorMessageFromError(error) {
	if (error.errors) {
		var message =  geErrorMessageFromError(error.errors[0]);
		if (message)
			return message;
	}
	if (error.error) {
		var message =  geErrorMessageFromError(error.error);
		if (message)
			return message;
	}
	if (error.message)
		return error.message;
	return error;
}

function getOrCreatePagerDutyUser(apiUrl, api_token, user_name, user_email, user_phone, callback) {
	var logPrefix = "[" + logBasePath + ".getOrCreatePagerDutyUser] ";
	var headers = {
		'Authorization': 'Token token=' + api_token,
		'user-agent': 'node.js'
	};
		
	// Check if the user account exists
	var url = apiUrl + "/users?query=" + encodeURIComponent(user_name);
	request.get({
		uri: url,
		json: true,
		headers: headers
	}, function(err, reqRes, body) {
		var accountExists = false;
		if (err) {
			logger.error(logPrefix + "Unable to verify if the user account already exists for user"
					+ " user_name: " + user_name 
					+ " failed with the following error: " + err.toString());
			return callback(err);
		} else if(reqRes.statusCode == 200) {
			// User account already exists
			accountExists = body.users.length > 0;
		} else if(reqRes.statusCode != 404) {
			// Unexpected error that is not 404 nor 200
			var message = getErrorMessageFromResult(reqRes);
			logger.error(logPrefix + "Unexpected error while verifying if the user account already exists for user"
					+ " user_name: " + user_name 
					+ " failed with the following error: " + message);
			return callback({description: message});				
		}
			
		if(accountExists) {
			// TODO: ensure user_email and user_phone are the one requested
			return callback(null, body.users[0]);
		} else {				
			// Create user account
			var url = apiUrl + "/users";
			request.post({
				uri: url,
				json: true,
				headers: headers,
				body: {
					name: user_name,
					email: user_email
				}
			}, function(err, reqRes, body) {
				if (err) {
					logger.error(logPrefix + "Creating the PagerDuty user for"
							+ " user_name: " + user_name 
							+ " failed with the following error: " + err.toString());
					return callback(err);
				} else if(reqRes && reqRes.statusCode != 201) {
					var message = getErrorMessageFromResult(reqRes);
					logger.error(logPrefix + "Creating the PagerDuty user for"
							+ " user_name: " + user_name 
							+ " failed with the following error: " + message);
					return callback({description: message});
				}
				// Create contact method with given user_phone
				var user = body.user;
				var contactMethodUrl = apiUrl + "/users/" + user.id + "/contact_methods";
				var phone = toPhoneNumberAndCountry(user_phone);
				request.post({
					uri: contactMethodUrl,
					json: true,
					headers: headers,
					body: {
			          contact_method: {
			              type: "phone",
			              country_code: phone.country,
			              address: phone.number,
			              label: user_name
			          }
					}
				}, function(err, reqRes, body) {
					if (err) {
						logger.error(logPrefix + "Creating the contact method for"
								+ " user_name: " + user_name 
								+ " failed with the following error: " + err.toString());
						return callback(err);
					} else if(reqRes && reqRes.statusCode != 201) {
						var message = getErrorMessageFromResult(reqRes);
						logger.error(logPrefix + "Creating the contact method for"
								+ " user_name: " + user_name 
								+ " failed with the following error: " + message);
						return callback({description: message});
					}
					return callback(null, user);
				});
			});
		}
	});
}

function getOrCreateEscalationPolicy(apiUrl, api_token, user, callback) {
	var logPrefix = "[" + logBasePath + ".getOrCreateEscalationPolicy] ";
	var headers = {
		'Authorization': 'Token token=' + api_token,
		'user-agent': 'node.js'
	};
	var escalation_name = "Call " + user.name;
			
	// Check if the escalation policy exists
	var url = apiUrl + "/escalation_policies?query=" + encodeURIComponent(escalation_name);
	request.get({
		uri: url,
		json: true,
		headers: headers
	}, function(err, reqRes, body) {
		var policyExists = false;
		if (err) {
			logger.error(logPrefix + "Unable to verify if the escalation policy already exists for user"
					+ " user_name: " + user_name 
					+ " failed with the following error: " + err.toString());
			return callback(err);
		} else if(reqRes.statusCode == 200) {
			// Escalation policy already exists
			policyExists = body.escalation_policies.length > 0;
		} else if(reqRes.statusCode != 404) {
			// Unexpected error that is not 404 nor 200
			var message = getErrorMessageFromResult(reqRes);
			logger.error(logPrefix + "Unexpected error while verifying if the escalation policy already exists for user"
					+ " user_name: " + user_name 
					+ " failed with the following error: " + message);
			return callback({description: message});				
		}
			
		if(policyExists) {
			return callback(null, body.escalation_policies[0]);
		} else {				
			// Create escalation policy
			var url = apiUrl + "/escalation_policies";
			request.post({
				uri: url,
				json: true,
				headers: headers,
				body: {
				    name: escalation_name,
				    escalation_rules: [{
				        escalation_delay_in_minutes: 30,
				        targets: [{
				            type: "user",
				            id: user.id
				        }]
				    }]
				}
			}, function(err, reqRes, body) {
				if (err) {
					logger.error(logPrefix + "Creating the PagerDuty escalation policy for user with"
							+ " user_name: " + user_name 
							+ " failed with the following error: " + err.toString());
					return callback(err);
				} else if(reqRes && reqRes.statusCode != 201) {
					var message = getErrorMessageFromResult(reqRes);
					logger.error(logPrefix + "Creating the PagerDuty escaltaion policy for user with"
							+ " user_name: " + user_name 
							+ " failed with the following error: " + message);
					return callback({description: message});
				}
				
				return callback(null, body.escalation_policy);
			});
		}
	});
}


function getOrCreatePagerDutyService(apiUrl, api_token, service_name, escalation_policy, callback) {
	var logPrefix = "[" + logBasePath + ".getOrCreatePagerDutyService] ";
	var headers = {
		'Authorization': 'Token token=' + api_token,
		'user-agent': 'node.js'
	};
			
	// Check if the service exists
	var url = apiUrl + "/services?query=" + encodeURIComponent(service_name);
	request.get({
		uri: url,
		json: true,
		headers: headers
	}, function(err, reqRes, body) {
		var serviceExists = false;
		if (err) {
			logger.error(logPrefix + "Unable to verify if the PagerDuty service already exists for"
					+ " service_name: " + service_name 
					+ " failed with the following error: " + err.toString());
			return callback(err);
		} else if(reqRes.statusCode == 200) {
			// Service already exists
			serviceExists = body.services.length > 0;
		} else if(reqRes.statusCode != 404) {
			// Unexpected error that is not 404 nor 200
			var message = getErrorMessageFromResult(reqRes);
			logger.error(logPrefix + "Unexpected error while verifying if the PagerDuty service already exists for"
					+ " service_name: " + service_name 
					+ " failed with the following error: " + message);
			return callback({description: message});				
		}
			
		if(serviceExists) {
			return callback(null, body.services[0]);
		} else {				
			// Create a PagerDuty service
			var url = apiUrl + "/services";
			request.post({
				uri: url,
				json: true,
				headers: headers,
				body: {
				    name: service_name,
				    escalation_policy_id: escalation_policy.id,
				    type: "generic_events_api"
				}
			}, function(err, reqRes, body) {
				if (err) {
					logger.error(logPrefix + "Creating the PagerDuty service for"
							+ " service_name: " + service_name 
							+ " failed with the following error: " + err.toString());
					return callback(err);
				} else if(reqRes && reqRes.statusCode != 201) {
					var message = getErrorMessageFromResult(reqRes);
					logger.error(logPrefix + "Creating the PagerDuty service for"
							+ " service_name: " + service_name 
							+ " failed with the following error: " + message);
					return callback({description: message});
				}
				
				return callback(null, body.service);
			});
		}
	});
}

/* Simple transformation of phone numbers like "+1 555 123 4567" into
 * {
 *   country: 1,
 *   number: 5551234567
 * }
 * TODO: check for syntax errors in phone number
 */
function toPhoneNumberAndCountry(str) {
	var arr = str.split(' ');
	if (arr.length == 1) {
		return {
			country: 1,
			number: str
		}
	}
	var country = arr[0];
	if (country[0] == '+') {
		return {
			country: Number(country.substring(1, country.length)),
			number: concat(arr, 1)
		}
	} else {
		return {
			country: 1,
			number: concat(arr, 0)
		}
	}
}

function concat(arr, start) {
	var result = "";
	for (var i=start; i < arr.length; i++) {
		result += arr[i];
	}
	return result;
}
