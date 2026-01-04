// { "id": "kindle-display", "libDeps": ["faye-websocket"], "modDeps": ["homeassistant"] }

import { HAModule } from './HAModule.js';
import WebSocketConnection from 'faye-websocket';
import http from 'node:http';
import url from 'node:url';

export default class MqttClient extends HAModule {
    kindleConnections = [];

    constructor(main) {
        super(main);
        this.ha = this.main.loadedModules.homeassistant;

        this.config ??= {};
        this.config.port ??= 4365;

        this.ha.on('message', msg => {
            switch(msg.type) {
                case 'auth_ok':
                    // Restore subscriptions of existing connections
                    for(let conn of this.kindleConnections) {
                        if(conn.meta.subscribedEntities) {
                            conn.meta.entitySubscriptionId = this.ha.messageId;
                            this.ha.sendMessage({
                                type: 'subscribe_entities',
                                entity_ids: conn.meta.subscribedEntities
                            });
                        }
                        if(conn.meta.subscribedEvents) {
                            for(let event of Object.keys(conn.meta.subscribedEvents)) {
                                conn.meta.subscribedEvents[event] = this.ha.messageId;
                                this.ha.sendMessage({
                                    type: 'subscribe_events',
                                    event_type: event
                                });
                            }
                        }
                    }
                    break;
                case 'event':
                    for(let conn of this.kindleConnections) {
                        if(conn.meta.entitySubscriptionId == msg.id) {
                            let entries = Object.entries(msg.event.a || msg.event.c)
                                    .map(([entityId, state]) => [entityId, state['+'] || state])
                                    .filter(([entityId, state]) => !!state.s || entityId.startsWith('automation'));
                            if(entries.length == 0) return;
                            let states = Object.fromEntries(entries);

                            conn.send(JSON.stringify({
                                type: 'state_change',
                                states: states,
                                firstUpdate: !!msg.event.a
                            }));
                        }

                        if(conn.meta.subscribedEvents) {
                            for(let [event, subId] of Object.entries(conn.meta.subscribedEvents)) {
                                if(subId == msg.id) {
                                    conn.send(JSON.stringify({
                                        type: 'event',
                                        name: event,
                                        data: msg.event.data
                                    }));
                                }
                            }
                        }
                    }
                    break;
                case 'result':
                    if(!msg.result) return;
                    for(let conn of this.kindleConnections) {
                        for(let request of conn.meta.pendingRequests) {
                            if(request.id == msg.id && request.type == 'history') {
                                // Fill gaps in history with zero entries
                                let processedHistory = {};
                                for(let [entityId, history] of Object.entries(msg.result)) {
                                    let prevEndTime = null;
                                    processedHistory[entityId] = [];
                                    for(let datapoint of history) {
                                        if(prevEndTime) {
                                            const timeDelta = datapoint.start - prevEndTime;
                                            if(timeDelta >= 3600000) {
                                                // Fill missing hours if timedelta more than an hour
                                                const hoursBetween = Math.floor(timeDelta / 3600000);
                                                for(let i=0; i<hoursBetween; i++) {
                                                    processedHistory[entityId].push({ mean: 0 });
                                                }
                                            }
                                        }
                                        processedHistory[entityId].push(datapoint);
                                        prevEndTime = datapoint.end;
                                    }
                                }
                                conn.send(JSON.stringify({
                                    type: 'history',
                                    history: processedHistory
                                }));
                            }
                        }
                    }
                    break;
            }
        });

        this.server = http.createServer();
        this.server.on('upgrade', (request, socket, body) => {
            if(this.config.accessToken) {
                const query = url.parse(request.url, true).query;
                if(query.accessToken != this.config.accessToken) {
                    socket.write(
                        'HTTP/1.1 401 Unauthorized\r\n' +
                        'Content-Type: text/plain; charset=UTF-8\r\n' +
                        'Content-Length: 16\r\n' +
                        '\r\n' +
                        '401 Unauthorized\r\n'
                    );
                    return;
                };
            }

            if(WebSocketConnection.isWebSocket(request)) {
                this.log(`Connection from ${socket.remoteAddress}`);

                let ws = new WebSocketConnection(request, socket, body);
                ws.receivedPing = true;
                ws.hearbeatTimer = setInterval(() => {
                    if(!ws.receivedPing) {
                        this.log(`Client ${socket.remoteAddress} timed out`);
                        ws.close();
                    } else {
                        ws.receivedPing = false;
                    }
                }, 21000);
                ws.meta = { pendingRequests: [] };
                this.kindleConnections.push(ws);

                ws.on('message', async event => {
                    if(!ws) return;
                    if(event.data == 'ping') {
                        ws.send('pong');
                        ws.receivedPing = true;
                        return;
                    }
                    const msg = JSON.parse(event.data);
                    switch(msg.type) {
                        case 'init':
                            ws.meta.entitySubscriptionId = this.ha.messageId;
                            ws.meta.subscribedEntities = msg.subscribeEntities;
                            this.ha.sendMessage({
                                type: 'subscribe_entities',
                                entity_ids: msg.subscribeEntities
                            });
                            
                            ws.meta.subscribedEvents = {};
                            for(let event of msg.subscribeEvents) {
                                ws.meta.subscribedEvents[event] = this.ha.messageId;
                                this.ha.sendMessage({
                                    type: 'subscribe_events',
                                    event_type: event
                                });
                            }
                            break;
                        case 'call_service':
                            this.ha.sendMessage({
                                type: 'call_service',
                                domain: msg.domain || 'homeassistant',
                                service: msg.service,
                                target: { entity_id: msg.entityId },
                                service_data: msg.data
                            });
                            break;
                        case 'fire_event':
                            this.ha.sendMessage({
                                type: 'fire_event',
                                event_type: msg.name,
                                event_data: msg.data
                            });
                            break;
                        case 'fetch_history': {
                            const startDate = new Date();
                            startDate.setHours(startDate.getHours() - (msg.days || 24));
                            ws.meta.pendingRequests.push({id: this.ha.messageId, type: 'history' });
                            this.ha.sendMessage({
                                type: 'recorder/statistics_during_period',
                                start_time: startDate.toISOString(),
                                period: 'hour',
                                types: ['mean'],
                                statistic_ids: [msg.entityId]
                            });
                            break;
                        }
                        case 'fetch_calendars': {
                            const startDate = new Date();
                            const endDate = new Date();
                            endDate.setDate(startDate.getDate() + (msg.days || 7));
                            
                            try {
                                let events = [];
                                for(let calendar of msg.calendars) {
                                    events.push(...await this.ha.getRequest(`calendars/${calendar}?start=${startDate.toISOString()}&end=${endDate.toISOString()}`));
                                }
                                events.forEach(event => {
                                    if(event.start?.date) event.start = new Date(event.start.date+'T00:00').getTime();
                                    if(event.start?.dateTime) event.start = new Date(event.start.dateTime).getTime();
                                    if(event.end?.date) event.end = new Date(event.end.date+'T00:00').getTime();
                                    if(event.end?.dateTime) event.end = new Date(event.end.dateTime).getTime();
                                });
                                events.sort((e1, e2) => e1.start - e2.start);
                                ws.send(JSON.stringify({
                                    type: 'calendars',
                                    events: events
                                }));
                            } catch(err) {
                                this.logError('Error updating calendars:', err);
                            }
                            break;
                        }
                    }
                });

                ws.on('close', event => {
                    this.log(`Client ${socket.remoteAddress} disconnected`);

                    if(ws.meta.entitySubscriptionId) {
                        this.ha.sendMessage({
                            type: 'unsubscribe_events',
                            subscription: ws.meta.entitySubscriptionId
                        });
                    }
                    if(ws.meta.subscribedEvents) {
                        for(let subId of Object.values(ws.meta.subscribedEvents)) {
                            this.ha.sendMessage({
                                type: 'unsubscribe_events',
                                subscription: subId
                            });
                        }
                    }
                    clearInterval(ws.hearbeatTimer);
                    this.kindleConnections.splice(this.kindleConnections.indexOf(ws), 1);
                    ws = null;
                });
            }
        });
    }

    start() {
        this.server.listen(this.config.port);
        this.log('Starting WebSocket server on port '+this.config.port);
    }
}
