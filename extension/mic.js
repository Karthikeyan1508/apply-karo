// The side panel frames the app from another origin, and Chrome decides microphone access by the
// page that holds the frame: this extension. The panel can't show Chrome's prompt, so a normal tab asks once.
const title = document.getElementById("title")
const note = document.getElementById("note")

navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then((stream) => {
    stream.getTracks().forEach((t) => t.stop())
    title.textContent = "Microphone allowed"
    note.textContent = "You can close this tab and talk in the side panel."
  })
  .catch(() => {
    title.textContent = "Microphone blocked"
    note.textContent = "Click the lock icon in the address bar, allow the microphone, and reload this tab."
  })
