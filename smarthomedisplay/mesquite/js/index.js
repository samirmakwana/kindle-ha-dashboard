// --- Kindle orientation ---
if (window.kindle && kindle.device && kindle.device.setOrientation) {
    kindle.device.setOrientation('landscapeLeft');
}

// --- Clock & Date ---
var daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var clockTime = document.getElementById('clockTime');
var clockDate = document.getElementById('clockDate');

function padTime(num) { return ('0' + num).slice(-2); }
function formatTime(date) { return padTime(date.getHours()) + ':' + padTime(date.getMinutes()); }

function updateClock() {
    var date = new Date();
    if (clockTime) clockTime.innerText = formatTime(date);
    if (clockDate) {
        clockDate.innerText =
            daysOfWeek[date.getDay()] + ', ' +
            date.getDate() + '. ' +
            months[date.getMonth()] + ' ' +
            date.getFullYear();
    }
    setTimeout(updateClock, 60000 - date.getSeconds() * 1000);
}
updateClock();

// --- WebSocket ---
var ws;
var reconnectInterval = 5 * 60 * 1000;

function createSocket() {
    if (!WS_URL) return;

    ws = new WebSocket(WS_URL);

    ws.onopen = function () {
        ws.send(JSON.stringify({
            type: 'init',
            subscribeEntities: [
                'media_player.battv',
                'media_player.lazarus',
                'media_player.joker',
                'media_player.playstation_5',
                'sensor.pirateweather_temperature',
                'sensor.nightwing_battery_level',
                'sensor.batphone_battery_level',
                'light.bedroomhue'
            ],
            subscribeEvents: []
        }));

        setTimeout(function () {
            if (ws.readyState === WebSocket.OPEN) ws.close();
        }, 30000);
    };

    ws.onmessage = function (event) {
        if (event.data === 'pong') return;

        try {
            var msg = JSON.parse(event.data);
            if (msg.type !== 'state_change') return;

            for (var id in msg.states) {
                var stateObj = msg.states[id];
                var state = stateObj.s;
                var attrs = stateObj.a || {};
                var el = document.querySelector('[data-entity-id="' + id + '"]');
                if (!el) continue;

                var valEl = el.getElementsByClassName('val')[0];
                var imgEl = el.getElementsByTagName('img')[0];

                // --- Media players ---
                if (el.classList.contains('media-card')) {
                    if (valEl) valEl.innerText = state || 'Off';
                    el.style.backgroundColor =
                        (state === 'playing' || state === 'on') ? '#d8d8d8' : '';
                }

                // --- Battery cards ---
                else if (
                    id === 'sensor.nightwing_battery_level' ||
                    id === 'sensor.batphone_battery_level'
                ) {
                    var level = parseInt(state);
                    if (isNaN(level) && attrs.battery_level !== undefined) {
                        level = parseInt(attrs.battery_level);
                    }

                    if (!isNaN(level) && valEl) {
                        valEl.innerText = level;

                        if (imgEl) {
                            if (level >= 80) imgEl.src = 'img/badges/battery-100.svg';
                            else if (level >= 50) imgEl.src = 'img//badges/battery-60.svg';
                            else if (level >= 20) imgEl.src = 'img/badges/battery-40.svg';
                            else imgEl.src = 'img/badges/battery-20.svg';
                        }
                    }
                }

                // --- Temperature / generic sensors ---
                else if (el.classList.contains('card')) {
                    var num = parseFloat(state);
                    if (valEl) valEl.innerText = !isNaN(num) ? Math.round(num) : state;
                }

                // --- Buttons / lights ---
                else if (el.classList.contains('button')) {
                    if (state === 'on') el.classList.add('active');
                    else el.classList.remove('active');
                }
            }
        } catch (e) {
            console.log('WS parse error', e);
        }
    };

    ws.onclose = function () {
        setTimeout(createSocket, reconnectInterval);
    };
}

createSocket();

// --- Weather (Pirate Weather) ---
function updateWeather() {
    var LAT = 22.3072;
    var LON = 73.1812;
    var API_KEY = 'API_KEY';

    var url =
        'https://api.pirateweather.net/forecast/' +
        API_KEY + '/' + LAT + ',' + LON +
        '?units=si&exclude=minutely,alerts,hourly,flags';

    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || xhr.status !== 200) return;

        try {
            var data = JSON.parse(xhr.responseText);
            var forecasts = document.querySelectorAll('#weatherWidget .forecast');
            if (!data.daily || !data.daily.data) return;

            var today = new Date();

            for (var i = 0; i < forecasts.length; i++) {
                var fc = forecasts[i];
                var dayData = data.daily.data[i];
                if (!dayData) continue;

                var dayEl = fc.querySelector('.day');
                var imgEl = fc.querySelector('img');
                var hiEl = fc.querySelector('.temp');
                var loEl = fc.querySelector('.temp-sm');

                if (dayEl) {
                    if (i === 0) dayEl.innerText = 'Today';
                    else {
                        var d = new Date(today);
                        d.setDate(today.getDate() + i);
                        dayEl.innerText = daysOfWeek[d.getDay()];
                    }
                }

                if (imgEl && dayData.icon) {
                    imgEl.src = 'img/weather/' +
                        dayData.icon.replace(/-day|-night/, '') + '.svg';
                }

                if (hiEl) hiEl.innerText = Math.round(dayData.temperatureHigh);
                if (loEl) loEl.innerText = Math.round(dayData.temperatureLow);
            }
        } catch (e) {
            console.log('Weather parse error', e);
        }
    };

    xhr.open('GET', url, true);
    xhr.send();
}

updateWeather();
setInterval(updateWeather, 2 * 60 * 60 * 1000);
