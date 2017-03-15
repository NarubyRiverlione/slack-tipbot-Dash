'use strict'

function toSmall(largeAmount) {
  let checkMaxMin = (largeAmount * 1e8).toFixed(0)
  if (checkMaxMin > Number.MAX_SAFE_INTEGER || checkMaxMin < Number.MIN_SAFE_INTEGER) {
    return null
  } else {
    return parseInt(checkMaxMin, 10)
  }
}

function toLarge(smallAmount) {
  return (smallAmount / 1e8).toFixed(8)
}


module.exports = { toSmall, toLarge }
