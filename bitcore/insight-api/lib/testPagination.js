var dateStr='2017-07-20';
var gte = Math.round((new Date(dateStr)).getTime() / 1000);

//pagination
var lte = parseInt(req.query.startTimestamp) || gte + 86400;
var prev = this.formatTimestamp(new Date((gte - 86400) * 1000));
var next = lte ? this.formatTimestamp(new Date(lte * 1000)) : null;
var limit = parseInt(req.query.limit || BLOCK_LIMIT);
var more = false;
var moreTimestamp = lte;