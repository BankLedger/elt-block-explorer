var async = require('async');
var b1=false;
var b2=false;
async.parallel([
	function func1(done){
		console.log("exe f1");
		b1=true;
		return done();
	},
	function func2(done){
		console.log("exe f2");
		b2=true;
		return done();
	},
	function func3(done){
		console.log("exe f3");
		b1=true;
		return done();
	},
	function func4(done){
		console.log("exe f4");
		b2=true;
		return done();
	}
],function(err){
	console.log(111);
	if(b1===true && b2===true){
		console.log("end");
	}
	
});