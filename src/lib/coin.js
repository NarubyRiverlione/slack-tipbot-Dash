'use strict'

function toSmall(largeAmount) {
  let checkMaxMin = (largeAmount * 1e8).toFixed(0)
  if (checkMaxMin > Number.MAX_SAFE_INTEGER || checkMaxMin < Number.MIN_SAFE_INTEGER) {
    return null
  } else {
    return parseInt(checkMaxMin, 10)
  }
}

function toLarge(smallAmount, decimals = 8) {
  return (smallAmount / 1e8).toFixed(decimals)
}

function toFixed(amount, decimals) {
  let fAmount = parseFloat(amount)
  if (fAmount)
    return fAmount.toFixed(decimals).toString()  // toString to remove trailing zero's
  else
    return null
}

module.exports = { toSmall, toLarge, toFixed }
