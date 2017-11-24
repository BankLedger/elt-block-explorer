var http = require('http');
var socketio = require('socket.io');

var zmq = require('zmq');




function getAvaliableZMQPort(i){
	var socket = zmq.socket('sub');
	socket.subscribe('hashblock');
	socket.subscribe('rawtx');
	socket.on('message', function(msg) { 
		console.log('got message! '+i); 
	});
	
	
	socket.connect('tcp://127.0.0.1:'+15714);

}

getAvaliableZMQPort();


