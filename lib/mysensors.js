var util = require('util');

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

//function _MySensors(config, log, onCreated) {
function _MySensors(config, log) {
    
    var self = this;
    this._interface = null;
    this.clients = {};
    this.type = 'na';

    // this.onCreated = function(error) {
    //     if(typeof onCreated === 'function') onCreated(error);
    // };

    // this.onData = function (data, client) {
    // };

    // this.onConnectionChange=function(client){
    // };

    this.onError = function(err) {
        if (log) log.error(self.type + ' server error: ' + err);
    };

    this.write = function(data, ip) {
        try {
            if (!this._interface) {
                if (log) log.warn('Wrong serial data: ' + data);
                return;
            }
            if (log) log.debug('Send raw data: ' + data);
            this._write(data, ip);
        } catch (e) {
            if(log) log.info('Exeption: ' + e);
        }
    };

    this.isConnected = function (ip) {
        if (ip) return this.clients[ip] && this.clients[ip].connected;
        for (var i in this.clients) {
            if (this.clients[i].connected) {
                return true;
            }
        }
        return false;
    };

    this.stopConnectionTimer = function (client) {
        if (client.disconnectTimeout) clearTimeout(client.disconnectTimeout);
        client.disconnectTimeout = null;
    };

    this.restartConnectionTimer = function (client, timeout) {
        if(!timeout) timeout = config.connTimeout;
        client.dataReceived = false;
        if (client.disconnectTimeout) clearTimeout(client.disconnectTimeout);
        client.disconnectTimeout = setTimeout(this.watchdog.bind(this, client), timeout);
    };

    this.disconnected = function (client) {
        if (client.connected) {
            if (log) log.info('disconnected ' + (client.ip || ''));
            client.connected = false;
            this.onConnectionChange(client);
            this.stopConnectionTimer(client);
        }
    };

    this.zeroInterface = function () {
        this._interface = null; //???
    };
    this.watchdog = function (client) {
        if (!client.connected) return;
        if (client.dataReceived === true) {
            this.restartConnectionTimer(client);
        } else if (client.dataReceived === false) {
            this.write('0;0;3;0;18;heartbeat', client.ip);
            this.restartConnectionTimer(client, 2000); // wait 2 sec for a heartbeat answer
            client.dataReceived = 2;
        } else {
            this.disconnected(client);
            this.zeroInterface();
        }
    };

    this._onData = function (data, ip, port) {
        if (typeof data != 'string') data = data.toString();
        if (!this.clients[ip]) {
            this.clients[ip] = { connected: false, ip: ip, port: port };
        }
        var client = this.clients[ip];
        client.dataReceived = true;
        if (!client.connected) {
            if (config.connTimeout) this.restartConnectionTimer(client);
            if (log) log.info('Connected ' + client.ip + ':' + client.port);
            client.connected = true;

            //give time to precess this received data
            setTimeout(this.onConnectionChange.bind(this, client), 1500);
        }
        if (data.length) {
            this.onData(data, this.clients[ip]);
        }
    };

    // this.destroy = function () {
    //     if (this._interface) {
    //         this._interface.close();
    //     }
    // };
    
    this.logWrite = function (err, ip, data) {
        if (log) {
            if (err) log.error('Cannot send to ' + ip + '[' + data + ']: ' + err);
            else log.debug('Sent to ' + ip + ' ' + data);
        }
    };
    
    this._write = function (data, ip) {
        if (!this.writeRaw(data, ip) && !ip) {
            for (var i in this.clients) {
                this.writeRaw(data, i);
            }
        } else if (log) {
            log.error('Cannot send to ' + ip + ' because not connected');
        }
    };
    
    return this;
}

_MySensors.prototype.onConnectionChange = function(client) {
};
_MySensors.prototype.onData = function (data, client) {
};
_MySensors.prototype.onCreated = function (error) {
};
_MySensors.prototype.destroy = function () {
    if (this._interface) {
        this._interface.close();
    }
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// function MySensorsUDP(config, log, onCreated) {
//     _MySensors.call(this, config, log, onCreated);
function MySensorsUDP(config, log) {
    _MySensors.call(this, config, log);

    var dgram = require('dgram');
    this.type = 'udp';
    this._interface = dgram.createSocket('udp4');

    this._interface.on('error', function (err) {
       this.onError(err);
    }.bind(this));

    this._interface.on('message', function (data, rinfo) {
        this._onData(data, rinfo.address, rinfo.port);
    }.bind(this));

    this._interface.on('listening', function () {
        if (log) log.info('UDP server listening on port ' + config.port || 5003);
        // if (this.config.ip === '255.255.255.255') {
        //     this._interface.setBroadcast(true);
        // }
        this.onCreated();
    }.bind(this));

    if (config.mode === 'server') {
        this._interface.bind(config.port || 5003, config.bind || undefined);
        var buf = new Buffer('0;0;3;0;18;heartbeat');
    
        adapter.getDevices(function(err, res) {
            if (err || !res || res.length <= 0) return;
            var reIp = /[^0-9]/g;
            var iPs = [];
            res.forEach(function (obj) {
                var ip = obj._id.split('.')[2].replace(reIp, '.');
                if (ip.indexOf('..') < 0 && iPs.indexOf(ip) < 0) iPs.push(ip);
            });
            iPs.forEach(function(ip) {
                this._interface.send(buf, 0, buf.length, config.port || 5003, ip, function (err) {
                });
            }.bind(this));
        
        }.bind(this));
    } else {
    }
    this.zeroInterface = function () {
    };

    this.writeRaw = function(data, ip) {
        var self = this;
        if (this.clients[ip] && this.clients[ip].connected && this.clients[ip].port) {
            this._interface.send(new Buffer(data), 0, data.length, this.clients[ip].port, ip, function (err) {
                if (self && typeof self.logWrite == 'function') {
                    self.logWrite(err, ip, data);
                }
            }); //).bind(this);
            return true;
        }
        return false;
    };

    return this;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// function MySensorsTCP(config, log, onCreated) {
//     _MySensors.call(this, config, log, onCreated);
function MySensorsTCP(config, log) {
    _MySensors.call(this, config, log);
    this.type = 'tcp';
    var net = require('net');
    this._interface = net.createServer(function (socket) {
        var ip = socket.remoteAddress;
        var port = socket.remotePort;

        this._onData("", socket.remoteAddress, socket.remotePort);
        this.clients[ip].socket = socket;

        socket.on('data', function (data) {
            this._onData(data, ip, port);
        }.bind(this));

        this.onClose = function (ip) {
            socket.destroy();
            if (this.clients[ip]) {
                this.clients[ip].socket = null;
                this.clients[ip].closed = true;
            }
            this.disconnected(this.clients[ip]);
            delete this.clients[ip];
        };

        socket.on('error', function (err) {
            if (err) this.onError(err);
            this.onClose(ip);
        }.bind(this));

        socket.on('close', function () {
            if (log) log.warn('Connection "' + ip + '" closed unexpectedly');
            this.onClose(ip)
        }.bind(this));

        socket.on('end', function () {
        }.bind(this));

    }.bind(this));

    this._interface.listen(config.port || 5003, config.bind || undefined, function (err) {
        if (log && err) log.error('TCP server error: ' + err);
        if (err) process.exit(1);
        if (log) log.info('TCP server listening on port ' + config.port || 5003);
        this.onCreated();
    }.bind(this));

    this.writeRaw = function (data, ip) {
        if (this.clients[ip] && this.clients[ip].connected && this.clients[ip].socket) {
            this.clients[ip].socket.write(data + '\n', function (err) {
                this.logWrite(err,ip,data);
            }).bind(this);
            return true;
        }
        return false;
    };
    
    return this;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// function MySensorsSerial(config, log, onCreated) {
//     _MySensors.call(this, config, log, onCreated);
function MySensorsSerial(config, log) {
    _MySensors.call(this, config, log);
    this.type = 'serial';
    var serialPortModule;
    try {
        serialPortModule = require('serialport');
    } catch (e) {
        console.warn('Serial port is not available');
    }
    if (serialPortModule) {
        var portConfig = {baudRate: config.baudRate || 115200, autoOpen: false /*, parser: serialport.parsers.readline('\n')*/};

        if (!config.comName) {
            if (log) log.error('No serial port defined');
            return;
        }
        try {
            this._interface = new serialPortModule(config.comName, portConfig, false);
            this._interface.open(function (error) {
                if (error) {
                    this.onCreated(error);
                } else {
                    log.info('Serial port opened');
                    this._interface.on('error', this.onError.bind(this));
                    this._interface.on('end', function(err) {
                         if(log) log.info('Serial.end');
                    }.bind(this));

                    ondata = (data) => {
                        this._onData(data, "Serial", config.comName);
                    };

                    this.parser = new serialPortModule.parsers.Readline({delimiter: '\n'});
                    if (this.parser) {
                        this.parser = this._interface.pipe(this.parser);
                        this.parser.on('data', ondata)
                    } else {
                        serialPort.on('data', ondata);
                    }
                    this.onCreated();
                }
            }.bind(this));
        }
        catch (e) {
            if (log) log.error('Cannot open serial port "' + config.comName + '": ' + e);
            this._interface = null;
        }
    }

    this._write = function (data, ip) {
        this._interface.write(data + '\n');
    };

    return this;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


var adapter;

// function MySensors(_adapter, type, onCreated) {
//     adapter = _adapter;
//     //switch (adapter.config.type) {
//     switch (type) {
//         case 'udp': return MySensorsUDP.call    (this, adapter.config, adapter.log, onCreated);
//         case 'tcp': return MySensorsTCP.call    (this, adapter.config, adapter.log, onCreated);
//         default:    return MySensorsSerial.call (this, adapter.config, adapter.log, onCreated);
//     }
// }

function MySensors(_adapter, type) {
    adapter = _adapter;
    //switch (adapter.config.type) {
    switch (type) {
        case 'udp': return MySensorsUDP.call    (this, adapter.config, adapter.log);
        case 'tcp': return MySensorsTCP.call    (this, adapter.config, adapter.log);
        default:    return MySensorsSerial.call (this, adapter.config, adapter.log);
    }
}
MySensors.prototype = _MySensors.prototype; //??


module.exports = MySensors;