'use strict';

const $ = (id) => document.getElementById(id);
window.desktopSettings.read().then((settings) => {
  $('serverUrl').value = settings.serverUrl;
  $('localHost').value = settings.localHost;
  $('ip6v').value = settings.hostIps['6v'];
  $('ipnoha').value = settings.hostIps.noha;
  $('share6v').value = settings.hostShares['6v'];
  $('sharenoha').value = settings.hostShares.noha;
}).catch((err) => { $('error').textContent = String(err.message || err); });
$('cancel').addEventListener('click', () => window.desktopSettings.close());
$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('save').disabled = true; $('error').textContent = '';
  try {
    await window.desktopSettings.save({
      serverUrl: $('serverUrl').value,
      localHost: $('localHost').value,
      hostIps: { '6v': $('ip6v').value, noha: $('ipnoha').value },
      hostShares: { '6v': $('share6v').value, noha: $('sharenoha').value },
    });
  } catch (error) {
    $('error').textContent = '无法保存，请检查 IP、共享名和地址：' + String(error.message || error);
    $('save').disabled = false;
  }
});
