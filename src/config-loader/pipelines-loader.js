const logger = require('../log').config;
const actions = require('../actions').init();
const conditions = require('../conditions');
const express = require('express');
const vhost = require('vhost')
const mm = require('micromatch')
const ConfigurationError = require('../errors').ConfigurationError;

module.exports.bootstrap = function(app, config) {
  validateConfig(config);
  let apiEndpointToPipelineMap = {}
  for (const [pipelineName, pipeline] of Object.entries(config.pipelines)) {
    logger.debug(`processing pipeline ${pipelineName}`)
    let router = configurePipeline(pipeline.policies || [], config)
    for (let apiName of pipeline.apiEndpoints) {
      apiEndpointToPipelineMap[apiName] = router
    }
  }

  let apiEndpoints = processApiEndpoints(config.apiEndpoints);
  for (let [host, hostConfig] of Object.entries(apiEndpoints)) {
    let router = express.Router()
    router.use((req, res, next) => {
      req.egContext = req.egContext || {}
      logger.debug("processing vhost %s %j", host, hostConfig.routes)
      for (let route of hostConfig.routes) {
        if (route.pathRegex) {
          if (req.url.match(RegExp(route.pathRegex))) {
            logger.debug("regex path matched for apiEndpointName %s", route.apiEndpointName)
            req.egContext.apiEndpoint = route
            return apiEndpointToPipelineMap[route.apiEndpointName](req, res, next);
          }
          continue;
        }

        let paths = route.paths ? (Array.isArray(route.paths) ? route.paths : [route.paths]) : ['**']
          // defaults to serve all requests
        for (let path of paths) {
          if (mm.isMatch(req.url, path)) {
            logger.debug("path matched for apiEndpointName %s", route.apiEndpointName)
            req.egContext.apiEndpoint = route;
            return apiEndpointToPipelineMap[route.apiEndpointName](req, res, next);
          }
        }
      }
      return next()
    })
    if (!host || host === '*' || host === '**') {
      app.use(router);
    } else {
      let virtualHost = hostConfig.isRegex ? new RegExp(host) : host
      app.use(vhost(virtualHost, router));
    }
  }
  return app;
}

function processApiEndpoints(apiEndpoints) {
  let cfg = {}
  logger.debug('loading apiEndpoints %j', apiEndpoints)
  for (let [apiEndpointName, endpointConfig] of Object.entries(apiEndpoints)) {
    let host = endpointConfig.hostRegex
    let isRegex = true;
    if (!host) {
      host = endpointConfig.host || '*'
      isRegex = false
    }

    cfg[host] = cfg[host] || { isRegex, routes: [] };
    logger.debug('processing host: %s, isRegex: %s', host, cfg[host].isRegex)
    let route = Object.assign({ apiEndpointName }, endpointConfig)
    logger.debug('adding route to host: %s, %j', host, route)
    cfg[host].routes.push(route)
  }
  return cfg
}

function configurePipeline(policies, config) {
  let router = express.Router();
  conditions.init()
  for (let [policyName, policySteps] of Object.entries(policies)) {
    for (let policyStep of policySteps) {
      const condition = policyStep.condition;
      const actionCtr = actions.resolve(policyStep.action.name, policyName);
      if (!actionCtr) {
        throw new ConfigurationError(
          `Could not find action "${policyStep.action.name}"`);
      }
      const action = actionCtr(policyStep.action, config);

      router.use((req, res, next) => {
        if (!condition || req.matchEGCondition(condition)) {
          logger.debug('request matched condition for action', policyStep.action);
          action(req, res, next);
        } else {
          logger.debug(`request did not matched condition for action`, policyStep.action);
          next();
        }
      });
    }
  }


  return router;
}

function validateConfig(config) {
  if (!config) {
    throw new ConfigurationError("No config provided")
  }
  if (!config.pipelines) {
    throw new ConfigurationError("No pipelines found")
  }
  if (!config.apiEndpoints) {
    throw new ConfigurationError("No apiEndpoints found")
  }
}