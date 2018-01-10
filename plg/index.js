// @ts-check
/// <reference path="../index.d.ts" />

/**
 * @typedef {Object} cAdvisorParams - creates a new type named 'SpecialType'
 * @property {string} headerName
 */

const metrics = require('prom-client');

const statusCodeCounter = new metrics.Counter({
  name: 'status_codes',
  help: 'status_code_counter',
  labelNames: ['type', 'status_code', 'consumer']
});

/** @type {ExpressGateway.Plugin} */
const plugin = {
  version: '1.0.0',
  policies: ['cAdvisor'],
  init: function (pluginContext) {
    pluginContext.registerAdminRoute((app) => {
      app.get('/metrics', (req, res) => {
        if (req.accepts(metrics.register.contentType)) {
          res.contentType(metrics.register.contentType);
          return res.send(metrics.register.metrics());
        }

        return res.json(metrics.register.getMetricsAsJSON());
      });
    });

    pluginContext.registerPolicy({
      schema: {
        $id: 'http://express-gateway.io/policies/cAdvisor.json',
        type: 'object',
        properties: {
          headerName: {
            type: 'string',
            default: 'eg-consumer-id'
          }
        }
      },
      name: 'cAdvisor',
      policy: (params) => (req, res, next) => {
        /** @type {cAdvisorParams} */
        const p = params;
        res.once('finish', () => {
          let cnt;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            cnt = statusCodeCounter.labels('SUCCESS', res.statusCode.toString(), req.header(p.headerName) || 'anonymous');
          } else {
            cnt = statusCodeCounter.labels('FAILED', res.statusCode.toString(), req.header(p.headerName) || 'anonymous');
          }

          cnt.inc();
        });

        next();
      }
    });
  }
};

module.exports = plugin;
