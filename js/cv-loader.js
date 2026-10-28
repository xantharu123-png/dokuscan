// Lädt OpenCV.js (Bilderkennung) einmalig und liefert das fertig initialisierte cv-Objekt.

let loading = null;

export function loadCv(src = 'vendor/opencv.js') {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => whenReady(window.cv, resolve);
    script.onerror = () => reject(new Error('OpenCV konnte nicht geladen werden'));
    document.head.appendChild(script);
  });
  return loading;
}

function whenReady(cv, resolve) {
  // Das Emscripten-Modul hat eine eigene then()-Methode. Ein Promise mit diesem Objekt aufzulösen
  // würde then() endlos erneut aufrufen und die Seite einfrieren – deshalb wird sie vorher entfernt.
  const done = () => {
    delete cv.then;
    resolve(cv);
  };
  if (cv.Mat) done();
  else cv.onRuntimeInitialized = done;
}
