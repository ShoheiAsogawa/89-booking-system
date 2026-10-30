(function(global) {
  'use strict';

  function QueryBuilder(client, table) {
    this.client = client;
    this.query = {
      table: table,
      operation: 'select',
      columns: '*',
      filters: [],
      or: [],
      order: []
    };
  }

  QueryBuilder.prototype.select = function(columns) {
    this.query.columns = columns || '*';
    if(this.query.operation === 'select') this.query.operation = 'select';
    else this.query.returning = true;
    return this;
  };
  QueryBuilder.prototype.insert = function(payload) { this.query.operation = 'insert'; this.query.payload = payload; return this; };
  QueryBuilder.prototype.update = function(payload) { this.query.operation = 'update'; this.query.payload = payload; return this; };
  QueryBuilder.prototype.upsert = function(payload, options) {
    this.query.operation = 'upsert'; this.query.payload = payload;
    if(options && options.onConflict) this.query.onConflict = options.onConflict;
    return this;
  };
  QueryBuilder.prototype.delete = function() { this.query.operation = 'delete'; return this; };
  ['eq','neq','gt','gte','lt','lte','is','in'].forEach(function(operator) {
    QueryBuilder.prototype[operator] = function(column, value) {
      this.query.filters.push({ column: column, operator: operator, value: value }); return this;
    };
  });
  QueryBuilder.prototype.not = function(column, innerOperator, value) {
    this.query.filters.push({ column: column, operator: 'not', innerOperator: innerOperator, value: value }); return this;
  };
  QueryBuilder.prototype.match = function(values) {
    var self = this;
    Object.keys(values || {}).forEach(function(column) { self.eq(column, values[column]); });
    return this;
  };
  QueryBuilder.prototype.or = function(expression) { this.query.or.push(String(expression || '')); return this; };
  QueryBuilder.prototype.order = function(column, options) {
    this.query.order.push({ column: column, ascending: !options || options.ascending !== false }); return this;
  };
  QueryBuilder.prototype.limit = function(value) { this.query.limit = Number(value); return this; };
  QueryBuilder.prototype.range = function(from, to) { this.query.range = { from: Number(from), to: Number(to) }; return this; };
  QueryBuilder.prototype.single = function() { this.query.single = true; this.query.returning = this.query.operation !== 'select' || this.query.returning; return this; };
  QueryBuilder.prototype.maybeSingle = function() { this.query.maybeSingle = true; this.query.returning = this.query.operation !== 'select' || this.query.returning; return this; };

  QueryBuilder.prototype.execute = async function() {
    try {
      var sessionResult = await this.client.auth.getSession();
      var token = sessionResult && sessionResult.data && sessionResult.data.session && sessionResult.data.session.access_token;
      var headers = { 'Content-Type': 'application/json' };
      if(token) headers.Authorization = 'Bearer ' + token;
      var response = await fetch('/api/db', {
        method: 'POST', headers: headers, body: JSON.stringify(this.query), cache: 'no-store'
      });
      var payload = await response.json().catch(function() { return {}; });
      if(!response.ok || payload.error) {
        return { data: null, error: payload.error || { message: 'Cloudflare D1 API error (' + response.status + ')', code: 'D1_API_ERROR' }, count: null };
      }
      return { data: payload.data, error: null, count: payload.count == null ? null : payload.count, truncated: payload.truncated === true };
    } catch(error) {
      return { data: null, error: { message: error && error.message ? error.message : String(error), code: 'NETWORK_ERROR' }, count: null };
    }
  };
  QueryBuilder.prototype.then = function(resolve, reject) { return this.execute().then(resolve, reject); };

  global.createCloudflareDbClient = function(supabaseClient) {
    return new Proxy(supabaseClient, {
      get: function(target, property) {
        if(property === 'from') return function(table) { return new QueryBuilder(target, table); };
        var value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };
})(window);
