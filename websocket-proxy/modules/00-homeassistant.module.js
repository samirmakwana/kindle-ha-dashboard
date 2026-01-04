// { "id": "homeassistant" }

import { EventEmitter } from 'node:events';
import { HAModule } from './HAModule.js';

export default class MqttClient extends HAModule {
    ws = null;
    hearbeatTimer = null;
    receivedPong = false;
    messageId = 1;

    constructor(main) {
        super(main);
        this.emitter = new EventEmitter();

        this.config ??= {};
        if(!this.config.wsUrl) throw new Error('WebSocket url not specified');
    }

    start() {
        this.connect();
    }

    connect() {
        this.ws = new WebSocket(this.config.wsUrl+'/api/websocket');
        this.ws.addEventListener('open', event => {
            this.log('Connecting to '+this.config.wsUrl);
            this.receivedPong = true;
            this.hearbeatTimer = setInterval(() => {
                if(!this.receivedPong) {
                    this.log('WebSocket connection timed out');
                    this.ws.close();
                }
                if(this.ws.readyState == WebSocket.OPEN) {
                    this.receivedPong = false;
                    this.sendMessage({ type: 'ping' });
                }
            }, 10000);
        });
        this.ws.addEventListener('message', event => {
            const msg = JSON.parse(event.data);
            switch(msg.type) {
                case 'pong':
                    this.receivedPong = true;
                    break;
                case 'auth_required':
                    if(!this.config.accessToken) throw new Error('Auth required, but no access token specified');
                    this.ws.send(JSON.stringify({
                        type: 'auth',
                        access_token: this.config.accessToken
                    }));
                    break;
                case 'auth_ok':
                    this.log('Sucessfully authenticated');
                default:
                    this.emit('message', msg);
            }
        });
        this.ws.addEventListener('close', event => {
            this.log('Connection closed');
            clearInterval(this.hearbeatTimer);
            setTimeout(() => {
                this.connect();
            }, 10000);
            this.emit('close');
        });
        this.ws.addEventListener('error', error => {
            this.logError('Connection error');
            setTimeout(() => {
                this.connect();
            }, 10000);
        });
    }

    sendMessage = (msg) => {
        if(this.ws.readyState != WebSocket.OPEN) return;
        msg.id = this.messageId++;
        this.ws.send(JSON.stringify(msg));
    }

    on(...args) {
        this.emitter.on(...args);
    }
    off(...args) {
        this.emitter.off(...args);
    }
    emit(...args) {
        this.emitter.emit(...args);
    }

    async postRequest(endpoint, data) {
        const res = await fetch(`${this.config.wsUrl}/api/${endpoint || ''}`, {
            method: 'POST',
            headers: {
                authorization: 'Bearer '+this.config.accessToken
            },
            body: JSON.stringify(data)
        });
        if(!res.ok) throw new Error('Post request returned abnormal status code: '+res.status);
        return res.json();
    }

    async getRequest(endpoint) {
        const res = await fetch(`${this.config.wsUrl}/api/${endpoint || ''}`, {
            headers: {
                authorization: 'Bearer '+this.config.accessToken
            }
        });
        if(!res.ok) throw new Error('Post request returned abnormal status code: '+res.status);
        return res.json();
    }
}
