// popup.js
const tokenInput = document.getElementById('token');
const saveBtn = document.getElementById('save');
const status = document.getElementById('status');

chrome.runtime.sendMessage({ type: 'GET_TOKEN' }, (res) => {
  if (res?.extension_token) { tokenInput.value = res.extension_token; status.textContent = '✅ Verbunden'; }
});

saveBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'SET_TOKEN', token: tokenInput.value }, () => {
    status.textContent = '✅ Token gespeichert — verbunden!';
  });
});
