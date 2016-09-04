'use strict';

function toDuff(dash) {
    let checkMaxMin = (dash * 1e8).toFixed(0);
    if (checkMaxMin > Number.MAX_SAFE_INTEGER || checkMaxMin < Number.MIN_SAFE_INTEGER) {
        return null;
    } else {
        return parseInt(checkMaxMin, 10);
    }
}

function toDash(duff) {
    return (duff / 1e8).toFixed(8);
}


module.exports= {toDash,toDuff};
