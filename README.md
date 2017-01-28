![Logo](admin/mysensors.png)
# ioBroker.mysensors-2
=================

[![NPM version](http://img.shields.io/npm/v/iobroker.mysensors-2.svg)](https://www.npmjs.com/package/iobroker.mysensors-2)
[![Tests](http://img.shields.io/travis/soef/ioBroker.mysensors-2/master.svg)](https://travis-ci.org/soef/ioBroker.mysensors-2)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat)](https://github.com/soef/iobroker.mysensors-2/blob/master/LICENSE)

This adapter communicates with [mysensors](http://www.mysensors.org) serial or ethernet gateway (TCP or UDP). 
It ethernet gateway selected in this case ioBroker is server, that expects connections.

## Based on ioBroker.mysensors
https://github.com/ioBroker/ioBroker.mysensors

## Prerequires
To use serial port on Windows it is VS required to build the binary.
To use serial port on linux it is build-essential an python2.7 required. To install them just write:

```
sudo apt-get update
sudo apt-get install build-essential
sudo apt-get install python2.7
```

