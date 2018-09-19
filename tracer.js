const _ = require('lodash');

var emptySpan = {
  finish: _.noop,
  setTag: _.noop,
  addTags: _.noop,
  context: _.noop,
  tracer: () => { return emptyTracer; },
  setOperationName: _.noop
};

var emptyTracer = module.exports = {
  startSpan: () => { return emptySpan; },
  inject: _.noop,
  extract: _.noop,
  Tags: {}
};
