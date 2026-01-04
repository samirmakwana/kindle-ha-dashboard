var errorBox;
if(DEBUG_MODE) {
    errorBox = document.createElement('div');
    errorBox.id = 'errorBox';
    document.body.appendChild(errorBox);

    window.onerror = function(msg, source, line) {
        errorBox.innerHTML += '[Error] ' + msg + ' in '+source+'#' + line + '<br>';
        return false;
    };
}
function logError(msg) {
    console.error(msg);
    if(DEBUG_MODE) errorBox.innerHTML += '[Error] ' + msg + '<br>';
};
function log(msg) {
    console.log(msg);
    if(DEBUG_MODE) errorBox.innerHTML += '[LOG] ' + msg + '<br>';
};
