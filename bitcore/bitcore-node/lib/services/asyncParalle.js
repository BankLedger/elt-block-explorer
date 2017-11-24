var async = require('async');
async.parallel([
	function func1(done){
		console.log("exe f1");
		return done(null,555);
	},
	function func2(done){
		console.log("exe f2");
		
		return done(null,6666);
	},
	function func3(done){
		console.log("exe f3");
		return done(null,777);
	},
	function func4(done){
		console.log("exe f4");
		
		return done(null,888);
	}

],function(err,data){
	console.log("..."+data);
	console.log("end");
});