var util =              require('util');
var EventEmitter =      require('events').EventEmitter;

function _MySensors(config, log, onCreated) {
    this._interface = null;
    this.clients = {};

    this.onCreated = function(error) {
        if(onCreated) onCreated(error);
    };

    this.onData = function (data, client) {
    };

    this.onConnectionChange=function(client){
    };

    this.onError = function(err) {
        if (log) log.error(config.type + ' server error: ' + err);
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
            this._interface = null; //???
        }
    };

    //this.updateWatchdog = function (client) {
    //    client.dataReceived = true;
    //    if (!client.connected) {
    //        if (config.connTimeout) this.restartConnectionTimer(client);
    //        if (log) log.info('Connected ' + client.ip + ':' + client.port);
    //        client.connected = true;
    //
    //        //give time to precess this received data
    //        setTimeout(this.onConnectionChange.bind(this, client), 1500);
    //    }
    //};

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

    this.destroy = function () {
        if (this._interface) {
            this._interface.close();
        }
    };

    return this;
}


function MySensorsUDP(config, log, onCreated) {
    _MySensors.call(this, config, log, onCreated);

    var dgram = require('dgram');
    this._interface = dgram.createSocket('udp4');

    //this._interface.on('error', function (err) {
    //    this.onError(err);
    //}.bind(this));
    this._interface.on('error', this.onError.bind(this));

    this._interface.on('message', function (data, rinfo) {
        this._onData(data, rinfo.address, rinfo.port);
    }.bind(this));

    this._interface.on('listening', function () {
        if (log) log.info('UDP server listening on port ' + config.port || 5003);
        this.onCreated();
    }.bind(this));

    if (config.mode === 'server') {
        this._interface.bind(config.port || 5003, config.bind || undefined);
    } else {
    }

    this.logWrite = function (err, ip, data) {
        if (log) {
            if (err) log.error('Cannot send to ' + ip + '[' + data + ']: ' + err);
            else log.debug('Sent to ' + ip + ' ' + data);
        }
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


function MySensorsTCP(config, log, onCreated) {
    MySensorsUDP.call(this, config, log, onCreated);

    var net = require('net');
    this._interface = net.createServer(function (socket) {
        var ip = socket.remoteAddress;
        var port = socket.remotePort;

        this._onData("", socket.remoteAddress, socket.remotePort);
        this.clients[ip].socket = socket;

        //// this must be per connection
        //if (!this.clients[ip] || !this.clients[ip].connected) {
        //    if (log) log.info('Connected ' + ip + ':' + socket.remotePort);
        //    this.clients[ip] = clients[ip] || {};
        //    this.clients[ip].connected = true;
        //    this.clients[ip].port = socket.remotePort;
        //    this.clients[ip].socket = socket;
        //    this.clients[ip].ip = ip;
        //
        //    this.emit('connectionChange', true, ip, port);
        //}
        //var buffer = '';

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
    }).bind(this);

    this.writeRaw = function (data, ip) {
        if (this.clients[ip] && clients[ip].connected && clients[ip].socket) {
            clients[ip].socket.write(data + '\n', function (err) {
                this.logWrite(err,ip,data);
            }).bind(this);
            return true;
        }
        return false;
    };

    return this;
}


function MySensorsSerial(config, log, onCreated) {
    _MySensors.call(this, config, log, onCreated);

    var serialport;
    try {
        serialport = require('serialport');
    } catch (e) {
        console.warn('Serial port is not available');
    }
    if (serialport) {
        var portConfig = {baudRate: config.baudRate || 115200, parser: serialport.parsers.readline('\n')};
        var SerialPort = serialport.SerialPort;

        if (!config.comName) {
            if (log) log.error('No serial port defined');
            return;
        }
        try {
            this._interface = new SerialPort(config.comName, portConfig, false);
            this._interface.open(function (error) {
                if (error) {
                    this.onCreated(error);
                } else {
                    log.info('Serial port opened');
                    this._interface.on('data', function (data) {
                        this._onData(data, "Serial", config.comName);
                    }.bind(this));
                    this._interface.on('error', this.onError.bind(this));
                    this._interface.on('end', function(err) {
                         if(log) log.info('Serial.end');
                    }.bind(this));
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


function MySensors(config, log, onCreated) {
    switch (config.type) {
        case 'udp': return MySensorsUDP.call(this, config,log,onCreated);
        case 'tcp': return MySensorsTCP.call(this, config,log,onCreated);
        default: return MySensorsSerial.call(this, config,log,onCreated);
    }
}





function okMySensors(options, log, onCreated) {
    if (!(this instanceof MySensors)) return new MySensors(adapter, states);
    this._interface = null;
    this.serialConnected = false;
    var clients = {};
    var lastMessageTs;

    this.onData = function (data, ip, port) {
    };

    if (options.type === 'udp') {
        var dgram = require('dgram');
        this._interface = dgram.createSocket('udp4');

        this._interface.on('error', function (err) {
            if (log) log.error('UDP server error: ' + err);
        });

        this._interface.on('message', function (data, rinfo) {
            data = data.toString();

            // this must be per connection
            if (!clients[rinfo.address] || !clients[rinfo.address].connected) {
                if (log) log.info('Connected ' + rinfo.address + ':' + rinfo.port);
                clients[rinfo.address] = clients[rinfo.address] || {};
                clients[rinfo.address].connected = true;
                clients[rinfo.address].port = rinfo.port;

                var addresses = [];
                for (var addr in clients) {
                    if (clients[addr].connected) addresses.push(addr);
                }

                this.emit('connectionChange', addresses.join(', '), rinfo.address, rinfo.port);
            }

            // Do not reset timeout too often
            if (options.connTimeout && (!clients[rinfo.address] || !clients[rinfo.address].lastMessageTs || new Date().getTime() - clients[rinfo.address].lastMessageTs > 1000)) {
                if (clients[rinfo.address].disconnectTimeout) clearTimeout(clients[rinfo.address].disconnectTimeout);
                clients[rinfo.address].disconnectTimeout = setTimeout(function (addr, port) {
                    this.disconnected(addr, port);
                }.bind(this), options.connTimeout, rinfo.address, rinfo.port);
            }

            clients[rinfo.address].lastMessageTs = new Date().getTime();

            if (data.split(';').length < 6) {
                if (log) log.warn('Wrong UDP data received from ' + rinfo.address + ':' + rinfo.port + ': ' + data);
            } else {
                if (log) log.debug('UDP data received from ' + rinfo.address + ':' + rinfo.port + ': ' + data);
                this.emit('data', data, rinfo.address, rinfo.port);
            }
        }.bind(this));

        this._interface.on('listening', function () {
            if (log) log.info('UDP server listening on port ' + options.port || 5003);
            if (onCreated) onCreated();
        }.bind(this));

        if (options.mode === 'server') {
            this._interface.bind(options.port || 5003, options.bind || undefined);
        } else {

        }
    } else if (options.type === 'tcp') {

        var net = require('net');

        this._interface = net.createServer(function (socket) {
            var ip = socket.remoteAddress;
            var port = socket.remotePort;

            // this must be per connection
            if (!clients[ip] || !clients[ip].connected) {
                if (log) log.info('Connected ' + ip + ':' + socket.remotePort);
                clients[ip] = clients[ip] || {};
                clients[ip].connected = true;
                clients[ip].port = socket.remotePort;
                clients[ip].socket = socket;

                var addresses = [];
                for (var addr in clients) {
                    if (clients[addr].connected) addresses.push(addr);
                }

                this.emit('connectionChange', addresses.join(', '), ip, port);
            }
            var buffer = '';

            socket.on('data', function (data) {
                data = data.toString();

                buffer += data;
                if (data.split(';').length < 6) {
                    if (log) log.warn('Wrong TCP data received from ' + ip + ':' + port + ': ' + data.replace('\n', ''));
                } else {
                    if (log) log.debug('\nTCP data received from ' + ip + ':' + port + ': ' + data.replace('\n', ''));
                    setTimeout(function () {
                        this.emit('data', data, ip, port);
                    }.bind(this), 0);
                }
            }.bind(this));

            socket.on('error', function (err) {
                if (log && err) log.error('Error for "' + ip + '": ' + err);
                if (clients[ip]) clients[ip].socket = null;
                this.disconnected(ip, port);
                socket.destroy();
            }.bind(this));

            socket.on('close', function () {
                // request closed unexpectedly
                if (clients[ip] && clients[ip].socket) {
                    clients[ip].socket = null;
                    if (log) log.warn('Connection "' + ip + '" closed unexpectedly');
                    this.disconnected(ip, port);
                    socket.destroy();
                }
            }.bind(this));

            socket.on('end', function () {
                buffer = '';
            }.bind(this));

        }.bind(this));

        this._interface.on('error', function (err) {
            if (log) log.error('TCP server error: ' + err);
        });

        this._interface.listen(options.port || 5003, options.bind || undefined, function (err) {
            if (log && err) log.error('TCP server error: ' + err);
            if (err) process.exit(1);
            if (log) log.info('TCP server listening on port ' + options.port || 5003);
            if (onCreated) onCreated();
        });
    } else { // serial;
        var serialport;
        try {
            serialport = require('serialport');
        } catch (e) {
            console.warn('Serial port is not available');
        }
        if (serialport) {
            var portConfig = {baudRate: options.baudRate || 115200, parser: serialport.parsers.readline('\n')};
            var SerialPort = serialport.SerialPort;

            if (options.comName) {
                try {
                    this._interface = new SerialPort(options.comName, portConfig, false);
                    this._interface.open(function (error) {
                        if (error) {
                            //log.error('Failed to open serial port: ' + error);
                            if (onCreated) onCreated(error);
                        } else {
                            log.info('Serial port opened');
                            // forward data
                            if (options.connTimeout) {
                                this.restartConnectionTimer();
                            }
                            this._interface.on('data', function (data) {

                                function onFirstData(self) {
                                    if (log) log.info('Connected to ' + options.comName);
                                    self.serialConnected = true;
                                    //give time to precess this received data
                                    setTimeout(function () {
                                        self.emit('connectionChange', true);
                                    }, 1000);
                                }

                                if (typeof data != 'string') data = data.toString();

                                if (options.connTimeout) {
                                    lastMessageTs = new Date().getTime();
                                }

                                if (!this.serialConnected) {
                                    onFirstData(this);
                                }
                                //this.emit('data', data, "Serial");
                                this.onData(data, { ip: "Serial", port: ""} );
                                //this.onData(data, "Serial");
                            }.bind(this));

                            this._interface.on('error', function (err) {
                                if (log) log.error('Serial error: ' + err);
                            });

                            if (onCreated) onCreated();
                        }
                    }.bind(this));
                }
                catch (e) {
                    if (log) log.error('Cannot open serial port "' + options.comName + '": ' + e);
                    this._interface = null;
                }
            } else {
                if (log) log.error('No serial port defined');
            }
        }
    }

    /////////////

    this.writeUDP = function (data, ip) {
        if (!this._interface) {
            if (log) log.warn('Wrong serial data: ' + data);
            return;
        }
        if (log) log.debug('Send raw data: ' + data);
        if (clients[ip] && clients[ip].connected && clients[ip].port) {
            this._interface.send(new Buffer(data), 0, data.length, clients[ip].port, ip, function (err) {
                if (log) {
                    if (err) {
                        log.error('Cannot send to ' + ip + '[' + data + ']: ' + err);
                    } else {
                        log.debug('Sent to ' + ip + ' ' + data);
                    }
                }
            });
        } else if (!ip) {
            for (var i in clients) {
                this._interface.send(new Buffer(data), 0, data.length, clients[i].port, i, function (err) {
                    if (log) {
                        if (err) {
                            log.error('Cannot send to ' + ip + '[' + data + ']: ' + err);
                        } else {
                            log.debug('Sent to ' + ip + ' ' + data);
                        }
                    }
                });
            }
        } else if (log) {
            log.error('Cannot send to ' + ip + ' because not connected');
        }
    };

    this.writeTCP = function (data, ip) {
        if (!this._interface) {
            if (log) log.warn('Wrong serial data: ' + data);
            return;
        }
        if (clients[ip] && clients[ip].connected && clients[ip].socket) {
            clients[ip].socket.write(data + '\n', function (err) {
                if (log) {
                    if (err) {
                        log.error('Cannot send to ' + ip + '[' + data + ']: ' + err);
                    } else {
                        log.debug('Sent to ' + ip + ' ' + data);
                    }
                }
            });
        } else if (!ip) {
            for (var i in clients) {
                clients[ip].socket.write(data + '\n', function (err) {
                    if (log) {
                        if (err) {
                            log.error('Cannot send to ' + ip + '[' + data + ']: ' + err);
                        } else {
                            log.debug('Sent to ' + ip + ' ' + data);
                        }
                    }
                });
            }
        } else if (log) {
            log.error('Cannot send to ' + ip + ' because not connected');
        }
    };

    this.writeSerial = function (data, ip) {
        if (!this._interface) {
            if (log) log.warn('Wrong serial data: ' + data);
            return;
        }
        this._interface.write(data + '\n');
    };

    switch (options.type) {
        case 'udp': this.write = this.writeUDP; break;
        case 'tcp': this.write = this.writeTCP; break;
        default: this.write = this.writeSerial; break;
    }

    this.isConnected = function (addr) {
        if (addr) {
            return clients[addr] && clients[addr].connected;
        } else {
            return this.serialConnected;
        }
    };

    this.stopConnectionTimer = function (obj) {
        if (!obj) obj = this;
        if (obj.disconnectTimeout) clearTimeout(obj.disconnectTimeout);
        obj.disconnectTimeout = null;
    };

    this.restartConnectionTimer = function (obj, dif) {
        if (typeof obj == 'number') { dif = obj; obj = this; }
        if (!obj) obj = this;
        if (!dif) dif = 0;
        if (obj.disconnectTimeout) clearTimeout(obj.disconnectTimeout);
        obj.disconnectTimeout = setTimeout(this.disconnected.bind(this), options.connTimeout - dif);
    };

    this.disconnected = function (addr) {
        if (addr) {
            if (clients[addr] && clients[addr].connected) {
                clients[addr].connected = false;
                var addresses = [];
                for (var addr in clients) {
                    if (clients[addr].connected) addresses.push(addr);
                }
                this.emit('connectionChange', addresses.join(', '), addr, clients[addr].port);
                // stop timer
                this.stopConnectionTimer();
                //if (clients[addr].disconnectTimeout) clearTimeout(clients[addr].disconnectTimeout);
                //clients[addr].disconnectTimeout = null;
            }
        } else
        if (this.serialConnected) {
            var dif = new Date().getTime() - lastMessageTs;
            if (dif < options.connTimeout) {
                this.restartConnectionTimer(dif);
                return;
            }
            ///xx
            if (log) log.info('disconnected ' + (addr || ''));
            this.serialConnected = false;
            this.emit('connectionChange', false, addr);
            // stop timer
            this.stopConnectionTimer();
            //if (this.disconnectTimeout) clearTimeout(this.disconnectTimeout);
            //this.disconnectTimeout = null;
        }
    };

    this.destroy = function () {
        if (this._interface) {
            if (options.type === 'udp') {
                this._interface.close();
            } else if (options.type === 'tcp') {
                this._interface.close();
            } else {
                //serial
                this._interface.close();
            }
        }
    };

    return this;
}





////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


function ok_without_client_parameter_MySensors(options, log, onCreated) {
    if (!(this instanceof MySensors)) return new MySensors(adapter, states);
    this._interface = null;
    this.serialConnected = false;
    var clients = {};
    var lastMessageTs;

    this.onData = function (data, ip, port) {
    };

    if (options.type === 'udp') {
        var dgram = require('dgram');
        this._interface = dgram.createSocket('udp4');

        this._interface.on('error', function (err) {
            if (log) log.error('UDP server error: ' + err);
        });

        this._interface.on('message', function (data, rinfo) {
            data = data.toString();

            // this must be per connection
            if (!clients[rinfo.address] || !clients[rinfo.address].connected) {
                if (log) log.info('Connected ' + rinfo.address + ':' + rinfo.port);
                clients[rinfo.address] = clients[rinfo.address] || {};
                clients[rinfo.address].connected = true;
                clients[rinfo.address].port = rinfo.port;

                var addresses = [];
                for (var addr in clients) {
                    if (clients[addr].connected) addresses.push(addr);
                }

                this.emit('connectionChange', addresses.join(', '), rinfo.address, rinfo.port);
            }

            // Do not reset timeout too often
            if (options.connTimeout && (!clients[rinfo.address] || !clients[rinfo.address].lastMessageTs || new Date().getTime() - clients[rinfo.address].lastMessageTs > 1000)) {
                if (clients[rinfo.address].disconnectTimeout) clearTimeout(clients[rinfo.address].disconnectTimeout);
                clients[rinfo.address].disconnectTimeout = setTimeout(function (addr, port) {
                    this.disconnected(addr, port);
                }.bind(this), options.connTimeout, rinfo.address, rinfo.port);
            }

            clients[rinfo.address].lastMessageTs = new Date().getTime();

            if (data.split(';').length < 6) {
                if (log) log.warn('Wrong UDP data received from ' + rinfo.address + ':' + rinfo.port + ': ' + data);
            } else {
                if (log) log.debug('UDP data received from ' + rinfo.address + ':' + rinfo.port + ': ' + data);
                this.emit('data', data, rinfo.address, rinfo.port);
            }
        }.bind(this));

        this._interface.on('listening', function () {
            if (log) log.info('UDP server listening on port ' + options.port || 5003);
            if (onCreated) onCreated();
        }.bind(this));

        if (options.mode === 'server') {
            this._interface.bind(options.port || 5003, options.bind || undefined);
        } else {

        }
    } else if (options.type === 'tcp') {

        var net = require('net');

        this._interface = net.createServer(function (socket) {
            var ip = socket.remoteAddress;
            var port = socket.remotePort;

            // this must be per connection
            if (!clients[ip] || !clients[ip].connected) {
                if (log) log.info('Connected ' + ip + ':' + socket.remotePort);
                clients[ip] = clients[ip] || {};
                clients[ip].connected = true;
                clients[ip].port = socket.remotePort;
                clients[ip].socket = socket;

                var addresses = [];
                for (var addr in clients) {
                    if (clients[addr].connected) addresses.push(addr);
                }

                this.emit('connectionChange', addresses.join(', '), ip, port);
            }
            var buffer = '';

            socket.on('data', function (data) {
                data = data.toString();

                buffer += data;
                if (data.split(';').length < 6) {
                    if (log) log.warn('Wrong TCP data received from ' + ip + ':' + port + ': ' + data.replace('\n', ''));
                } else {
                    if (log) log.debug('\nTCP data received from ' + ip + ':' + port + ': ' + data.replace('\n', ''));
                    setTimeout(function () {
                        this.emit('data', data, ip, port);
                    }.bind(this), 0);
                }
            }.bind(this));

            socket.on('error', function (err) {
                if (log && err) log.error('Error for "' + ip + '": ' + err);
                if (clients[ip]) clients[ip].socket = null;
                this.disconnected(ip, port);
                socket.destroy();
            }.bind(this));

            socket.on('close', function () {
                // request closed unexpectedly
                if (clients[ip] && clients[ip].socket) {
                    clients[ip].socket = null;
                    if (log) log.warn('Connection "' + ip + '" closed unexpectedly');
                    this.disconnected(ip, port);
                    socket.destroy();
                }
            }.bind(this));

            socket.on('end', function () {
                buffer = '';
            }.bind(this));

        }.bind(this));

        this._interface.on('error', function (err) {
            if (log) log.error('TCP server error: ' + err);
        });

        this._interface.listen(options.port || 5003, options.bind || undefined, function (err) {
            if (log && err) log.error('TCP server error: ' + err);
            if (err) process.exit(1);
            if (log) log.info('TCP server listening on port ' + options.port || 5003);
            if (onCreated) onCreated();
        });
    } else { // serial;
        var serialport;
        try {
            serialport = require('serialport');
        } catch (e) {
            console.warn('Serial port is not available');
        }
        if (serialport) {
            var portConfig = {baudRate: options.baudRate || 115200, parser: serialport.parsers.readline('\n')};
            var SerialPort = serialport.SerialPort;

            if (options.comName) {
                try {
                    this._interface = new SerialPort(options.comName, portConfig, false);
                    this._interface.open(function (error) {
                        if (error) {
                            //log.error('Failed to open serial port: ' + error);
                            if (onCreated) onCreated(error);
                        } else {
                            log.info('Serial port opened');
                            // forward data
                            if (options.connTimeout) {
                                this.restartConnectionTimer();
                            }
                            this._interface.on('data', function (data) {

                                function onFirstData(self) {
                                    if (log) log.info('Connected to ' + options.comName);
                                    self.serialConnected = true;
                                    //give time to precess this received data
                                    setTimeout(function () {
                                        self.emit('connectionChange', true);
                                    }, 1000);
                                }

                                if (typeof data != 'string') data = data.toString();

                                if (options.connTimeout) {
                                    lastMessageTs = new Date().getTime();
                                }

                                if (!this.serialConnected) {
                                    onFirstData(this);
                                }
                                //this.emit('data', data, "Serial");
                                this.onData(data, "Serial");
                            }.bind(this));

                            this._interface.on('error', function (err) {
                                if (log) log.error('Serial error: ' + err);
                            });

                            if (onCreated) onCreated();
                        }
                    }.bind(this));
                }
                catch (e) {
                    if (log) log.error('Cannot open serial port "' + options.comName + '": ' + e);
                    this._interface = null;
                }
            } else {
                if (log) log.error('No serial port defined');
            }
        }
    }

    /////////////

    this.writeUDP = function (data, ip) {
        if (!this._interface) {
            if (log) log.warn('Wrong serial data: ' + data);
            return;
        }
        if (log) log.debug('Send raw data: ' + data);
        if (clients[ip] && clients[ip].connected && clients[ip].port) {
            this._interface.send(new Buffer(data), 0, data.length, clients[ip].port, ip, function (err) {
                if (log) {
                    if (err) {
                        log.error('Cannot send to ' + ip + '[' + data + ']: ' + err);
                    } else {
                        log.debug('Sent to ' + ip + ' ' + data);
                    }
                }
            });
        } else if (!ip) {
            for (var i in clients) {
                this._interface.send(new Buffer(data), 0, data.length, clients[i].port, i, function (err) {
                    if (log) {
                        if (err) {
                            log.error('Cannot send to ' + ip + '[' + data + ']: ' + err);
                        } else {
                            log.debug('Sent to ' + ip + ' ' + data);
                        }
                    }
                });
            }
        } else if (log) {
            log.error('Cannot send to ' + ip + ' because not connected');
        }
    };

    this.writeTCP = function (data, ip) {
        if (!this._interface) {
            if (log) log.warn('Wrong serial data: ' + data);
            return;
        }
        if (clients[ip] && clients[ip].connected && clients[ip].socket) {
            clients[ip].socket.write(data + '\n', function (err) {
                if (log) {
                    if (err) {
                        log.error('Cannot send to ' + ip + '[' + data + ']: ' + err);
                    } else {
                        log.debug('Sent to ' + ip + ' ' + data);
                    }
                }
            });
        } else if (!ip) {
            for (var i in clients) {
                clients[ip].socket.write(data + '\n', function (err) {
                    if (log) {
                        if (err) {
                            log.error('Cannot send to ' + ip + '[' + data + ']: ' + err);
                        } else {
                            log.debug('Sent to ' + ip + ' ' + data);
                        }
                    }
                });
            }
        } else if (log) {
            log.error('Cannot send to ' + ip + ' because not connected');
        }
    };

    this.writeSerial = function (data, ip) {
        if (!this._interface) {
            if (log) log.warn('Wrong serial data: ' + data);
            return;
        }
        this._interface.write(data + '\n');
    };

    switch (options.type) {
        case 'udp': this.write = this.writeUDP; break;
        case 'tcp': this.write = this.writeTCP; break;
        default: this.write = this.writeSerial; break;
    }

    this.isConnected = function (addr) {
        if (addr) {
            return clients[addr] && clients[addr].connected;
        } else {
            return this.serialConnected;
        }
    };

    this.stopConnectionTimer = function (obj) {
        if (!obj) obj = this;
        if (obj.disconnectTimeout) clearTimeout(obj.disconnectTimeout);
        obj.disconnectTimeout = null;
    };

    this.restartConnectionTimer = function (obj, dif) {
        if (typeof obj == 'number') { dif = obj; obj = this; }
        if (!obj) obj = this;
        if (!dif) dif = 0;
        if (obj.disconnectTimeout) clearTimeout(obj.disconnectTimeout);
        obj.disconnectTimeout = setTimeout(this.disconnected.bind(this), options.connTimeout - dif);
    };

    this.disconnected = function (addr) {
        if (addr) {
            if (clients[addr] && clients[addr].connected) {
                clients[addr].connected = false;
                var addresses = [];
                for (var addr in clients) {
                    if (clients[addr].connected) addresses.push(addr);
                }
                this.emit('connectionChange', addresses.join(', '), addr, clients[addr].port);
                // stop timer
                this.stopConnectionTimer();
                //if (clients[addr].disconnectTimeout) clearTimeout(clients[addr].disconnectTimeout);
                //clients[addr].disconnectTimeout = null;
            }
        } else
        if (this.serialConnected) {
            var dif = new Date().getTime() - lastMessageTs;
            if (dif < options.connTimeout) {
                this.restartConnectionTimer(dif);
                return;
            }
            ///xx
            if (log) log.info('disconnected ' + (addr || ''));
            this.serialConnected = false;
            this.emit('connectionChange', false, addr);
            // stop timer
            this.stopConnectionTimer();
            //if (this.disconnectTimeout) clearTimeout(this.disconnectTimeout);
            //this.disconnectTimeout = null;
        }
    };

    this.destroy = function () {
        if (this._interface) {
            if (options.type === 'udp') {
                this._interface.close();
            } else if (options.type === 'tcp') {
                this._interface.close();
            } else {
                //serial
                this._interface.close();
            }
        }
    };

    return this;
}


// extend the EventEmitter class using our Radio class

util.inherits(MySensors, EventEmitter);

module.exports = MySensors;