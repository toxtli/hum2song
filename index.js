/**
 * @license
 * Copyright (c) 2018, Carlos Toxtli (@ctoxtli).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 * http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * VARIABLES
 */

let recorder;
let visualizer;
let instruments;
let notesPerChord;
let canvases = [];
let nowPlaying = 0;
let fullSong = null;
let runLocal = false;
let visualizers = [];
let visualizerArr = [];
let isInputVoice = true;
let isRecording = false;
let supportsMidi = false;
let audioRecorded = null;
let recordingBroken = false;
var midiDrums = [36, 38, 42, 46, 41, 43, 45, 49, 51];
let jazzHits = [51, 53, 54, 42, 59, 44, 46];
var audioCtx = new (AudioContext || webkitAudioContext)();
var tf;
var z1, z2;
var tsynth;
var drumMap;
var progSeqs;
var chordSeqs;
var programMap;
var playerMaster;
var globalReverb;
var globalLimiter;
const Z_DIM = 256;
const numSteps = 6;
const MAX_NOTE = 71;
const MIN_NOTE = 20;
const MAX_PAN = 0.2;
const MIN_DRUM = 35;
const MAX_DRUM = 81;
var sectionSize = 8;
var globalCompressor;
let numContainers = 9;
const STEPS_PER_QUARTER = 24;
const HUMANIZE_SECONDS = 0.01;
var chords = [];
var numChords = 4;
var numTimes = sectionSize / numChords;
var onsets_frames_uni = null;
var multitrack_chords = null;
var drum_kit_rnn = null;
var midiRecorder = null;
var trio_4bar = null;
var vae = null;
const pulsePattern = true;
const temperature = 1.1;
var TRIO_EXAMPLE = {
    notes: [],
    quantizationInfo: { stepsPerQuarter: 4 }
};

/*
 * METHODS
 */

function init() {
  initObjects();
  initModels();
}

function initObjects() {
  WebMidi.enable(function (err) {
    if (err) {
      console.log("WebMidi could not be enabled.", err);
      return;
    }
    console.log("WebMidi enabled!");
    if (WebMidi.inputs.length > 0) {
      console.log("Supports WebMidi");
      supportsMidi = true;
      startStreamBtn.disabled = false;
      var input = WebMidi.inputs[0];
      input.addListener('noteon', 1, function (e) {
        //let note = e.note.number
        let note = e.note.name + e.note.octave;
        tsynth.triggerAttack(note);
        //nsynthPlayer.noteOn(e.note.number);
      });
      input.addListener('noteoff', 1, function (e) {
        tsynth.triggerRelease();
        //nsynthPlayer.noteOff(e.note.number);
      });
    }
  });

  $('.container').each((index, element) => {
    var containerId = parseInt(element.id.split('_')[1]);
    element.addEventListener('click', () => {
      if (playerMaster.isPlaying()) {
        stopPlayerNum(containerId);
      } else {
        startPlayerNum(containerId);
      }
    });
  });

  $('.playCanvas').each((index, element) => {
    var containerId = parseInt(element.id.split('_')[1]);
    element.addEventListener('click', () => {
      if (playerMaster.isPlaying()) {
        stopPlayerNum(containerId);
        element.style.backgroundImage = 'url(assets/images/play.svg)';
      } else {
        startPlayerNum(containerId);
      }
    });
  });

  $('.downloadCanvas').each((index, element) => {
    var containerId = parseInt(element.id.split('_')[1]);
    element.addEventListener('click', () => {
      saveSequence(visualizerArr[containerId].noteSequence);
    });
  });

  $('.editCanvas').each((index, element) => {
    var containerId = parseInt(element.id.split('_')[1]);
    element.addEventListener('click', () => {
      exportSong(visualizerArr[containerId].noteSequence);
    });
  });

  playIconSimple.addEventListener('click', playFullSong);

  playIconAdvanced.addEventListener('click', playFullSong);

  stopIconSimple.addEventListener('click', stopFullSong);

  stopIconAdvanced.addEventListener('click', stopFullSong);

  btnSaveScore.addEventListener('click', () => {
    saveSequence(fullSong);
  });

  btnLoadSimple.addEventListener('click', () => {  
    loadSequence();
  });

  btnRecord.addEventListener('click', onClickRecord);

  btnRecordSimple.addEventListener('click', onClickRecord);

  btnSave.addEventListener('click', () => {  
    saveSequence(fullSong);
  });

  btnLoad.addEventListener('click', () => {  
    loadSequence();
  });

  startStreamBtn.addEventListener('click', () => {
    hideOptions();
    if (!midiRecorder.isRecording()) {
      midiRecorder.callbackObject = {
        run: (seq) => {
          if (seq) {
            visualizer = new mm.Visualizer(seq, canvas0, {
                noteRGB: '255, 255, 255', 
                activeNoteRGB: '232, 69, 164', 
                pixelsPerTimeStep: window.innerWidth < 500 ? null: 80,
            });
          }
        }
      };
      updateWorkingState([startStreamBtn], [btnUpload, btnRecord, btnRecordSimple]);
      startStreamBtn.textContent = 'STOP';
      midiRecorder.start();
    } else {
      startStreamBtn.textContent = 'PROCESSING...';
      const seq = midiRecorder.stop();
      if (seq) {
        let ns = mm.sequences.clone(seq);
        processNotes(ns).then((ns) => {
          step0.hidden = true;
          startStreamBtn.textContent = 'MIDI keyboard';
          resetUIState();
        });
      }
    }
  });

  fileInput.addEventListener('change', (e) => {
    hideOptions();
    updateWorkingState([btnUpload], [btnRecord, btnRecordSimple, startStreamBtn]);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      transcribeFromFile(e.target.files[0]);
      fileInput.value = null;
    }));
    return false;
  });
}

function initModels() {
  tf = mm.tf;
  onsets_frames_uni = new mm.OnsetsAndFrames('assets/models/onsets_frames_uni');
  trio_4bar = new mm.MusicVAE('assets/models/trio_4bar');
  multitrack_chords = new mm.MusicVAE('assets/models/multitrack_chords');
  midiRecorder = new mm.Recorder();
  loadMultitrack();
  tsynth = new Tone.FMSynth({
    "modulationIndex" : 12.22,
    "envelope" : {
      "attack" : 0.01,
      "decay" : 0.2
    },
    "modulation" : {
      "type" : "square"
    },
    "modulationEnvelope" : {
      "attack" : 0.2,
      "decay" : 0.01
    }
  }).toMaster();
  let soundFontUrl = 'https://storage.googleapis.com/download.magenta.tensorflow.org/soundfonts_js/sgm_plus';
  if (runLocal) {
    soundFontUrl = 'assets/sounds/sgm_plus'; 
  }
  playerMaster = new mm.SoundFontPlayer(soundFontUrl, globalCompressor, programMap, drumMap);  
  playerMaster.callbackObject = {
    run: (note) => {
      const currentNotePosition = visualizerArr[nowPlaying].redraw(note);

      // See if we need to scroll the container.
      let containerObj = window['container_' + nowPlaying];
      const containerWidth = containerObj.getBoundingClientRect().width;
      if (currentNotePosition > (containerObj.scrollLeft + containerWidth)) {
        containerObj.scrollLeft = currentNotePosition - 20;
      }
      let playObj = window['play_' + nowPlaying];
      playObj.style.backgroundImage = 'url(assets/images/stop.svg)';
    },
    stop: () => {
      let containerObj = window['container_' + nowPlaying];
      containerObj.classList.remove('playing');
      let playObj = window['play_' + nowPlaying];
      playObj.style.backgroundImage = 'url(assets/images/play.svg)';
    }
  };
  Promise.all([
    onsets_frames_uni.initialize(),
    trio_4bar.initialize(),
    midiRecorder.initialize(),
    multitrack_chords.initialize(),
    initMultitrack()
    //vae.initialize(),
    //drum_kit_rnn.initialize()
  ]).then(() => {
      resetUIState();
      modelLoading.hidden = true;
      modelReady.hidden = false;
      modelReadySimple.hidden = false;
  });
  
  // Things are slow on Safari.
  if (window.webkitOfflineAudioContext) {
    safariWarning.hidden = false;
  }
  
  // Things are very broken on ios12.
  if (navigator.userAgent.indexOf('iPhone OS 12_0') >= 0) {
    iosError.hidden = false;
    buttons.hidden = true;
  }
}

function toNoteSequence(pattern) {
  return mm.sequences.quantizeNoteSequence(
  {
    ticksPerQuarter: 220,
    totalTime: pattern.length / 2,
    timeSignatures: [
    {
      time: 0,
      numerator: 4,
      denominator: 4 }],
    tempos: [
    {
      time: 0,
      qpm: 120 }],
      notes: _.flatMap(pattern, function (step, index) {return (
          step.map(function (d) {return {
              pitch: midiDrums[d],
              startTime: index * 0.5,
              endTime: (index + 1) * 0.5 };}));}) }, 1);
}

function detectChord(notes) {
  notes = notes.map(function (n) {return Tonal.Note.pc(Tonal.Note.fromMidi(n.note));}).sort();
  return Tonal.PcSet.modes(notes).
  map(function (mode, i) {
    var tonic = Tonal.Note.name(notes[i]);
    var names = Tonal.Dictionary.chord.names(mode);
    return names.length ? tonic + names[0] : null;
  }).
  filter(function (x) {return x;});
}

function buildNoteSequence(seed) {
  var step = 0;
  var delayProb = pulsePattern ? 0 : 0.3;
  var notes = seed.map(function (n) {
    var dur = 1 + (Math.random() < delayProb ? 1 : 0);
    var note = {
      pitch: n.note,
      quantizedStartStep: step,
      quantizedEndStep: step + dur };

    step += dur;
    return note;
  });
  return {
    totalQuantizedSteps: _.last(notes).quantizedEndStep,
    quantizationInfo: {
      stepsPerQuarter: 1 },

    notes: notes };
}

function seqToTickArray(seq) {
  return _.flatMap(seq.notes, function (n) {return (
      [n.pitch].concat(
      pulsePattern ?
      [] :
      _.times(n.quantizedEndStep - n.quantizedStartStep - 1, function () {return null;})));});
}

function onClickRecord() {
  // Things are broken on old ios
  hideOptions();
  if (!navigator.mediaDevices) {
    recordingBroken = true;
    btnRecord.disabled = true;
    btnRecordSimple.disabled = true;
    startStreamBtn.disabled = true;
    return;
  }
  
  if (isRecording) {
    isRecording = false;
    updateRecordBtn(true);
    recorder.stop();
  } else {
    isRecording = true;
    updateRecordBtn(false);
    
    // Request permissions to record audio.
    navigator.mediaDevices.getUserMedia({audio: true}).then(stream => {
      recorder = new window.MediaRecorder(stream);
       recorder.addEventListener('dataavailable', (e) => {
         updateWorkingState([btnRecord, btnRecordSimple], [btnUpload, startStreamBtn]);
         audioRecorded = e.data;
         requestAnimationFrame(() => requestAnimationFrame(() => transcribeFromFile(e.data)));
      });
      recorder.start();
    });
  }
}

function initMultitrack() {
  return new Promise((resolve, reject) => {
    resolve();
  });
}

async function transcribeFromFile(blob) {
  audioControl.src = window.URL.createObjectURL(blob);
  onsets_frames_uni.transcribeFromAudioFile(blob).then((transcribed) => {
    processNotes(transcribed).then((ns) => {
      step0.hidden = false;
      resetUIState();
    });
  });
}

function getNoteNumber(letter, scale) {
  return allNoteLetters[letter] + 12 * (scale - 1);
}

function getNoteLetter(number) {
  return allNotes[number % 12];
}

function getNoteScale(number) {
  return parseInt(number / 12);
}

function getExactChordsFromNotes(notes) {
  let finalChord = [];
  let trie = cloneObject(chordTrie);
  chordsFromNote[notes[0]].forEach((chord1) => {
    if (trie.hasOwnProperty(chord1)) {
      chordsFromNote[notes[1]].forEach((chord2) => {
        if (trie[chord1].hasOwnProperty(chord2)) {
          chordsFromNote[notes[2]].forEach((chord3) => {
            if (trie[chord1][chord2].hasOwnProperty(chord3)) {
              chordsFromNote[notes[3]].forEach((chord4) => {
                if (trie[chord1][chord2][chord3].hasOwnProperty(chord4)) {
                  finalChord.push([chord1,chord2,chord3,chord4]);
                }
              });
            }
          });
        }
      });
    }
  });
  return finalChord;
}

function getProbableChordsFromNotesOld(notes) {
  let finalChord = {chords:[],max:0};
  let trie = cloneObject(chordTrie);
  for (let i in trie) {
    for (let j in trie[i]) {
      for (let k in trie[i][j]) {
        for (let l in trie[i][j][k]) {
          let count = 0;
          if (chordsFromNote[notes[0]].indexOf(i) != -1)
            count++;
          if (chordsFromNote[notes[1]].indexOf(j) != -1)
            count++;
          if (chordsFromNote[notes[2]].indexOf(k) != -1)
            count++;
          if (chordsFromNote[notes[3]].indexOf(l) != -1)
            count++;
          if (count > finalChord.max) {
            finalChord.max = count;
            finalChord.chords = [];
          }
          if (count == finalChord.max) {
            finalChord.chords.push([i,j,k,l])
          }
        }
      }
    }
  }
  return finalChord;
}

function truncateNumber(decimal) {
  return Math.floor(decimal * 100) / 100;
}

function displayPrediction(pred) {
  refGenre.innerText = pred[0];
  refDance.innerText = truncateNumber(pred[1][0]);
  refRock.innerText = truncateNumber(pred[1][1]);
  refJazz.innerText = truncateNumber(pred[1][2]);
}

function displayChords(chordRes) {
  refScale.innerText = chordRes[1];
  refChord.innerText = chordRes[0].join(', ');
}

function calculateMode(numbers) {
    // as result can be bimodal or multi-modal,
    // the returned result is provided as an array
    // mode of [3, 5, 4, 4, 1, 1, 2, 3] = [1, 3, 4]
    var modes = [], count = [], i, number, maxIndex = 0;
 
    for (i = 0; i < numbers.length; i += 1) {
        number = numbers[i];
        count[number] = (count[number] || 0) + 1;
        if (count[number] > maxIndex) {
            maxIndex = count[number];
        }
    }
 
    for (i in count)
        if (count.hasOwnProperty(i)) {
            if (count[i] === maxIndex) {
                modes.push(Number(i));
            }
        }
 
    return modes;
}

function normalizeNotes(ns) {
  let seq = mm.sequences.clone(ns);
  const notes_scale = 12
  const min_pitch = 36
  const max_pitch = 71
  const min_scale = parseInt(min_pitch / notes_scale)
  const max_scale = parseInt(max_pitch / notes_scale)
  const med_scale = Math.round((min_scale + max_scale) / 2)
  let mod_scales = med_scale;
  let scales = []
  for (let i in seq.notes) {
    scales.push(parseInt(seq.notes[i].pitch / notes_scale));
  }
  const mods_scales = calculateMode(scales);
  if (mods_scales.length == 1) {
    mod_scales = mods_scales[0];
  } else {
    if (mods_scales.indexOf(med_scale) == -1) {
      mod_scales = med_scale;
    } else {
      mod_scales = Math.max(mods_scales);
    }
  }
  const dif_scales = med_scale - mod_scales;
  const adjust = notes_scale * dif_scales;
  let toDelete = [];
  for (let i = 0; i < seq.notes.length; i++) {
    let note = seq.notes[i].pitch;
    let new_value = seq.notes[i].pitch + adjust;
    if (new_value >= MIN_NOTE && new_value <= MAX_NOTE) {
      seq.notes[i].pitch = new_value
    } else {
      toDelete.push(i);
    }
  }
  while (toDelete.length > 0) {
    let index = toDelete.pop();
    seq.notes.splice(index, 1);
  }
  return seq;
}

function playFullSong() {
  playerMaster.start(fullSong);
  playIconSimple.style.display = 'none';
  stopIconSimple.style.display = 'block';
  playIconAdvanced.style.display = 'none';
  stopIconAdvanced.style.display = 'block';
}

function stopFullSong() {
  playerMaster.stop();
  stopIconSimple.style.display = 'none';
  playIconSimple.style.display = 'block';
  stopIconAdvanced.style.display = 'none';
  playIconAdvanced.style.display = 'block';
}

function getInstrumentsFromGenre(genre) {
  let basses = [32, 33, 34, 35, 36, 37, 38, 39];
  let drumKicks = [35, 36];
  let melodies = [0];
  let drumHits = [42];
  let result = {
    'melody': 0,
    'bass': 32,
    'drumHit': 42,
    'drumKick': 36
  }
  if (genre == 'rock') {
    melodies = [24, 25, 26, 27, 28, 29, 30, 31];
    drumHits = [41, 43, 45, 47, 48];
  } else if (genre == 'electronic') {
    melodies = [80, 81, 82, 83, 84, 85, 86, 87];
    drumHits = [42, 44, 46];
  } else if (genre == 'jazz') {
    melodies = [56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67];
    drumHits = [51, 53, 54, 59];
  }
  result.bass = _.sample(basses);
  result.melody = _.sample(melodies);
  result.drumHit = _.sample(drumHits);
  result.drumKick = _.sample(drumKicks);
  return result;
}

function getDrumFromGenre(genre, genreInst) {
  let drum = getDrum(genre, genreInst.drumKick, genreInst.drumHit);
  return mm.sequences.unquantizeSequence(drum);
}

function processNotes(ns) {
  return new Promise(async (resolve, reject) => {
    if (isInputVoice) {
      let original = mm.sequences.clone(ns);
      visualizeSequence(original, 0);
      ns = normalizeNotes(ns);
      ns = moveToTimeZero(ns);
      let melody = mm.sequences.clone(ns);
      melody = removeOverlapped(melody);
      melody = resizeSequence(melody);
      visualizeSequence(melody, 1);
      let dupMelody = duplicateSequence(melody);
      let seqVector = sequenceToVector(dupMelody);
      let predGenreArr = await predict_genre([seqVector]);
      let pred_genre = predGenreArr[0];
      let genreInst = getInstrumentsFromGenre(pred_genre);
      melody = setParamsToNotes(melody, {instrument:0, program: genreInst.melody, isDrum: false});
      visualizeSequence(melody, 2);
      let melodyProc = setParamsToNotes(melody, {instrument:0, program: 0, isDrum: false});
      let chordRes = getChordsFromMelody(dupMelody);
      chords = chordRes[0];
      displayChords(chordRes);
      displayPrediction(predGenreArr);
      let bass = mm.sequences.clone(melody);
      bass = convertToPad(bass);
      bass = setParamsToNotes(bass, {instrument:1, program: genreInst.bass, isDrum: false});
      let drum = getDrumFromGenre(pred_genre, genreInst);
      drum = setParamsToNotes(drum, {instrument:2, isDrum: true});
      visualizeSequence(drum, 3);
      bass = moveOctaves(bass, -1);
      visualizeSequence(bass, 4);
      melody = moveOctaves(melody, 1);
      let genBlock = createBlock();
      addBlock(genBlock, melody, 0);
      addBlock(genBlock, bass, 0);
      addBlock(genBlock, drum, 0);
      //let blockVis = prepareToVisualize(genBlock);
      visualizeSequence(genBlock, 5);
      let procBlock = createBlock();
      addBlock(procBlock, melodyProc, 0);
      addBlock(procBlock, bass, 0);
      addBlock(procBlock, drum, 0);
      createTrio(procBlock).then((accompaniment) => {
        let generatedAcc = accompaniment[0];
        let unqAcc = mm.sequences.unquantizeSequence(generatedAcc);        
        let oriInst = separateInstruments(genBlock);
        let newInst = separateInstruments(unqAcc);
        let oriDruNS = oriInst['2'];
        let newDruNS = newInst['2'];
        let oriBasNS = oriInst['1'];
        let newBasNS = newInst['1'];
        let oriMelNS = oriInst['0'];
        let newMelNS = newInst['0'];
        newMelNS = setParamsToNotes(newMelNS, {instrument:0, program: genreInst.melody, isDrum: false});
        let newBlock = createBlock();
        addBlock(newBlock, newMelNS, 0);
        addBlock(newBlock, newBasNS, 0);
        addBlock(newBlock, newDruNS, 0);
        visualizeSequence(newBlock, 6);
        let testSong = createBlock();
        addBlock(testSong, drum, 0);
        addBlock(testSong, oriMelNS, 0);
        addBlock(testSong, newBasNS, 0);
        visualizeSequence(testSong, 7);
        let sampleBlock = createBlock();
        addBlock(sampleBlock, drum, 0);
        addBlock(sampleBlock, oriMelNS, 0);
        addBlock(sampleBlock, newBasNS, 0);
        encodeSong(sampleBlock).then(z => {
          z1 = z;
          generateSample(z => {
            z2 = z;
            processSong().then(finalPieces => {
              fullSong = finalPieces[0];
              visualizeSequence(finalPieces[1][0], 8);
              visualizeSequence(finalPieces[1][finalPieces[1].length-1], 9);
              visualizeSequence(fullSong, 10);
              playerMaster.loadSamples(fullSong).then(() => {
                songOptions.hidden = false;
                songOptionsAdvanced.hidden = false;
                playIconSimple.style.display = 'block';
                playIconAdvanced.style.display = 'block';
                resolve(fullSong);
              });
            });
          });
        });
      });
    } else {
      resolve(ns);
    }
  });
}

function notesToSequence(notes, time) {
  let newSeq = new mm.NoteSequence({notes: notes, totalTime: time})
  return newSeq;
}

function separateInstruments(ns) {
  let drumsId = '2';
  let exit = {};
  exit[drumsId] = [];
  for (var i in ns.notes) {
    if (!ns.notes[i].isDrum) {
      if (!exit.hasOwnProperty(ns.notes[i].instrument)) {
        exit[ns.notes[i].instrument] = [];
      }
      exit[ns.notes[i].instrument].push(ns.notes[i]);
    } else {
      exit[drumsId].push(ns.notes[i]);
    }
  }
  for (var i in exit) {
    exit[i] = notesToSequence(exit[i], ns.totalTime);
  }
  return exit;
}

function prepareToVisualize(ns) {
  let seq = mm.sequences.clone(ns);
  for (let i in seq.notes) {
    seq.notes[i].instrument = seq.notes[i].program;
  }
  return seq;
}

function getQuantizedSequence(ns, size) {
  let qns = mm.sequences.clone(ns);
  if (!mm.sequences.isQuantizedSequence(qns)) {
      qns = mm.sequences.quantizeNoteSequence(qns, size);
  }
  return qns;
}

function createTrio(ns) {
  return new Promise((resolve, reject) => {
    let qns = mm.sequences.quantizeNoteSequence(ns, 4);
    TRIO_EXAMPLE.notes = qns.notes;
    TRIO_EXAMPLE.totalQuantizedSteps = 64;
    let inputs = [TRIO_EXAMPLE];
    trio_4bar.encode(inputs).then((z) => {
      trio_4bar.decode(z).then((recon) => {
        resolve(recon);
      });
    });
  });
}

function concatNoteSequences(seqs, individualDuration) {
    var concatSeq = mm.sequences.clone(seqs[0]);
    var _loop_1 = function (i) {
        Array.prototype.push.apply(concatSeq.notes, seqs[i].notes.map(function (n) {
            var newN = mm.sequences.clone(n);
            newN.quantizedStartStep += individualDuration * i;
            newN.quantizedEndStep += individualDuration * i;
            return newN;
        }));
    };
    for (var i = 1; i < seqs.length; ++i) {
        _loop_1(i);
    }
    return concatSeq;
}

function createBlock() {
  let ns = new mm.NoteSequence({notes: [], totalTime: 0});
  return ns;
}

function addBlock(ns1, ns2, time) {
  let block = mm.sequences.clone(ns2);
  var notes = _.sortBy(block.notes, 'startTime');
  var lastTime = ns1.totalTime;
  for (var i in notes) {
    notes[i].startTime += time;
    notes[i].endTime += time;
    if (notes[i].endTime > lastTime) {
      lastTime = notes[i].endTime;
    }
    ns1.notes.push(notes[i]);
  }
  ns1.totalTime = lastTime;
  return ns1;
}

function mixNotes(ns1, ns2) {
  for (var i in ns2.notes) {
    ns1.notes.push(ns2.notes[i]);
  }
  return ns1;
}

function mixNotesAt(ns1, ns2, at) {
  for (var i in ns2.notes) {
    ns2.notes[i].startTime += at;
    ns2.notes[i].endTime += at;
    ns1.notes.push(ns2.notes[i]);
  }
  return ns1;
}

function removeOverlapped(ns) {
  if (ns.notes.length == 0)
    return ns;
  var notes = _.sortBy( ns.notes, 'startTime' );
  let range = notes[0];
  let toDelete = [];
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].startTime >= range.startTime && notes[i].startTime <= range.endTime) {
      if (notes[i].endTime <= range.endTime) {
        toDelete.push(i);
      } else {
        notes[i].startTime = range.endTime;
        range = notes[i];
      }
    } else if (notes[i].startTime < range.startTime) {
      if (notes[i].endTime > range.endTime) {
        notes[i].startTime = range.endTime;
        range = notes[i];
      } else if (notes[i].endTime <= range.endTime) {
        toDelete.push(i);
      }
    } else {
      range = notes[i];
    }
  }
  ns.totalTime = range.endTime;
  while (toDelete.length > 0) {
    notes.splice(toDelete.pop(), 1);
  }
  ns.notes = notes;
  return ns;
}

function convertToPad(ns) {
  if (ns.notes.length == 0)
    return ns;
  let toDelete = [];
  var notes = _.sortBy( ns.notes, 'startTime' );
  var last = notes[0];
  for (let i = 1; i < notes.length; i++) {
    last.endTime = notes[i].startTime;
    if (last.pitch != notes[i].pitch) {
      last = notes[i];
    } else {
      toDelete.push(i);
    }
  }
  last.endTime = ns.totalTime;
  while (toDelete.length > 0) {
    notes.splice(toDelete.pop(), 1);
  }
  ns.notes = notes;
  return ns;
}

function moveOctaves(ns, octaves) {
  if (ns.notes.length == 0)
    return ns;
  let toAdjust = 12 * octaves;
  for (let i = 0; i < ns.notes.length; i++) {
    ns.notes[i].pitch += toAdjust
  }
  return ns;
}

function resizeSequence(ns) {
  let octaves = parseInt(ns.totalTime / 8);
  let silence = getAverageSilence(ns);
  let fitToTime = octaves == 0 ? 4 : octaves * 8;
  let ns2 = expandSequence(ns, fitToTime, silence);
  ns.totalTime = fitToTime;
  return ns2;
}

function duplicateSequence(ns) {
  let seq = mm.sequences.clone(ns);
  let octaves = parseInt(seq.totalTime / 8);
  let fitToTime = octaves == 0? 4 : octaves * 8;
  let dupSeq = duplicateFrom(seq, fitToTime);
  return dupSeq;
}

function getChordsFromMelody(ns) {
  notesPerChord = getNotesPerChord(ns);
  return getChordFromNotes(notesPerChord);
}

function getNotesPerChord(ns) {
  var notes = [{},{},{},{}];
  var notesGlobal = {};
  let exitLocal = [];
  let exitGlobal = [];
  let cutEverySecs = 2;
  let pitchKey = '';
  for (let i in ns.notes) {
    let intStart = parseInt(parseInt(ns.notes[i].startTime) / cutEverySecs);
    let intEnd = parseInt(parseInt(ns.notes[i].endTime) / cutEverySecs);
    if (intStart < notes.length && intEnd < notes.length) {
      for (let j = intStart; j <= intEnd; j++) {
        let pitch = ns.notes[i].pitch;
        let duration = (ns.notes[i].endTime - (j * cutEverySecs)) - (ns.notes[i].startTime - (j * cutEverySecs));
        if (duration > cutEverySecs)
          duration = cutEverySecs;
        pitchKey = pitch + '';
        if (!notes[j].hasOwnProperty(pitchKey))
          notes[j][pitchKey] = 0;
        notes[j][pitchKey] += duration;
      }
    } else {
      break; 
    }
  }
  for (let i in notes) {
    exitLocal.push(_.sortBy(_.toPairs(notes[i]), 1).reverse());
    for (let j in notes[i]) {
      if (!notesGlobal.hasOwnProperty(j))
        notesGlobal[j] = 0;
      notesGlobal[j] += notes[i][j];
    }
  }
  exitGlobal = _.sortBy(_.toPairs(notesGlobal), 1).reverse();
  return {local: exitLocal, global: exitGlobal};
}

function getChordFromNotes(notes) {
  let tonal = getNoteLetter(notes.global[0][0]);
  let scale = getNoteScale(notes.global[0][0]);
  let notesPerTime = [
    getNoteLetter(notes.local[0][0][0]),
    getNoteLetter(notes.local[1][0][0]),
    getNoteLetter(notes.local[2][0][0]),
    getNoteLetter(notes.local[3][0][0])
  ]
  let probChrods = getProbableChordsFromNotes(tonal, notesPerTime);
  let finalChord = probChrods[Math.floor(Math.random()*probChrods.length)];
  return [finalChord, tonal, scale];
}

function setParamsToNotes(ns, params) {
  let seq = mm.sequences.clone(ns);
  for (var i in seq.notes) {
    for (var j in params) {
      seq.notes[i][j] = params[j];
    }
  }
  return seq;
}

function setInstrument(ns, instrument) {
  for (var i in ns.notes) {
    ns.notes[i].instrument = instrument;
    ns.notes[i].isDrum = false;
    ns.notes[i].program = instrument;
    // ns.notes[i].velocity = 100;
  }
  return ns;
}

function expandSequence(ns, time, silence) {
  let length = ns.totalTime + silence;
  let diff =  time - length;
  let ratio = Math.abs(diff) / length;
  let totalTime = time;
  if (diff > 0) {
    ratio += 1;
  } else {
    ratio = 1 - ratio;
  }
  for (var i in ns.notes) {
    ns.notes[i].startTime *= ratio;
    ns.notes[i].endTime *= ratio;
    totalTime = ns.notes[i].endTime;
  }
  ns.totalTime = totalTime;
  return ns;
}

function getAverageSilence(ns) {
  let times = 0;
  let total = 0;
  if (ns.notes.length > 1) {
    let prev = ns.notes[0];
    for (let i = 1; i < ns.notes.length; i++) {
      let diff = ns.notes[i].startTime - prev.endTime;
      if (diff > 0) {
        total += diff;
        times++;
      }
      prev = ns.notes[i];
    }
    if (times > 0)
      total /= times;
  }
  return total;
}

function duplicateFrom(ns, from) {
  let totalTime = from;
  for (let i in ns.notes) {
    let note = cloneObject(ns.notes[i]);
    note.startTime += from;
    note.endTime += from;
    totalTime = note.endTime;
    ns.notes.push(note);
  }
  ns.totalTime = totalTime;
  return ns;
}

function concatenateFrom(source, ns, from) {
  let totalTime = from;
  let cloned = mm.sequences.clone(ns);
  for (let i in cloned.notes) {
    let note = cloned.notes[i];
    note.startTime += from;
    note.endTime += from;
    totalTime = note.endTime;
    source.notes.push(note);
  }
  source.totalTime = totalTime;
  return source;
}

function cloneObject(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function visualizeSequence(ns, n) {
  let canvasObj = window['canvas' + n];
  visualizerArr[n] = new mm.Visualizer(ns, canvasObj, {
      noteRGB: '255, 255, 255', 
      activeNoteRGB: '232, 69, 164', 
      pixelsPerTimeStep: window.innerWidth < 500 ? null: 80,
  });
}

function fixPitch(ns) {
  let fns = mm.sequences.clone(ns);
  let seq = fns.notes.map(a => a.pitch);
  let minVal = 48;
  let minSeq = Math.min(...seq);
  if (minSeq < minVal) {
    let diff = minVal - minSeq;
    for (let i in fns.notes) {
      fns.notes[i].pitch += diff;
    }
  }
  return fns;
}

function fixMaxPitch(seq) {
  let minVal = 48;
  let minSeq = Math.min(...seq);
  if (minSeq < minVal) {
    let diff = minVal - minSeq;
    for (let i in seq) {
      seq[i] += diff;
    }
  }
  return seq;
}

function createArp(seq) {
  let notes = [];
  let time = 0;
  let duration = 0.125;
  let step = duration * 2;
  let noteSize = 8;
  let rounds = parseInt(seq.length / noteSize);
  if (rounds == 0 && seq.length >= 4) {
    rounds = 1;
    seq.length = 4;
    seq = seq.concat(seq);
  }
  seq.length = rounds * noteSize;
  seq = seq.concat(seq);
  for (let i in seq) {
    notes.push({pitch: seq[i], startTime: time, endTime: time + duration, velocity: 60});
    time += step;
  }
  let newSeq = new mm.NoteSequence({notes: notes, totalTime: time});
  return newSeq;
}

function combineSongs(song1, song2) {
  let notes = [];
  while (song1.notes.length != 0 || song2.notes.length !=0) {
    if (song1.notes.length > 0 && song2.notes.length > 0) {
      if (song1.notes[0].startTime < song2.notes[0].startTime) {
        notes.push(song1.notes.shift());
      } else {
        notes.push(song2.notes.shift());
      }
    } else if (song1.notes.length > 0) {
      notes.push(song1.notes.shift());
    } else if (song2.notes.length > 0) {
      notes.push(song2.notes.shift());
    }
  }
  let totalTime = song1.totalTime>song2.totalTime?song1.totalTime:song2.totalTime;
  let newSeq = new mm.NoteSequence({notes: notes, totalTime: totalTime})
  return newSeq;
}

function moveToTimeZero(ns) {
  if (ns.notes.length > 0) {
    let startTime = ns.notes.reduce((min, p) => p.y < min ? p.y : min, ns.notes[0].startTime);
    let endTime = 0;
    for (let i in ns.notes) {
      ns.notes[i].startTime -= startTime;
      if (ns.notes[i].startTime < 0)
        ns.notes[i].startTime = 0
      ns.notes[i].endTime -= startTime;
      if (ns.notes[i].endTime > endTime)
        endTime = ns.notes[i].endTime;
    }
    ns.totalTime = endTime;
  }
  return ns;
}

function startPlayerNum(n) {
  nowPlaying = n;
  let containerObj = window['container_' + n];
  containerObj.scrollLeft = 0;
  containerObj.classList.add('playing');
  playerMaster.start(visualizerArr[n].noteSequence, 0, {loop:true});
}

function stopPlayerNum(n) {
  let containerObj = window['container_' + n];
  playerMaster.stop();
  containerObj.classList.remove('playing');
}

function updateWorkingState(actives, inactives) {
  for (let active of actives) {
    if (active) {
      active.classList.add('working');
    }
  }
  for (let inactive of inactives) {
    if (inactive) {
      inactive.setAttribute('disabled', true);  
    }
  }
}

function updateRecordBtn(defaultState) {
  const el = btnRecord.firstElementChild;
  el.textContent = defaultState ? 'Record audio' : 'Stop'; 
  const elSimple = btnRecordSimple.firstElementChild;
  elSimple.textContent = defaultState ? 'Record audio' : 'Stop'; 
}

function setActiveLevel(event, isAdvanced) {
  document.querySelector('button.player.active').classList.remove('active');
  event.target.classList.add('active');
  if (isAdvanced) {
    simple.style.display = 'none';
    btnSimpleMode.classList.remove('chosen');
    advance.style.display = 'block';
    btnAdvanceMode.classList.add('chosen');
  } else {
    simple.style.display = 'block';
    btnSimpleMode.classList.add('chosen');
    advance.style.display = 'none';
    btnAdvanceMode.classList.remove('chosen');
  }
}

function hideOptions() {
  songOptions.hidden = true;
  songOptionsAdvanced.hidden = true;
}

function resetUIState() {
  btnUpload.classList.remove('working');
  btnUpload.removeAttribute('disabled');
  if (supportsMidi) {
    startStreamBtn.classList.remove('working');
    startStreamBtn.removeAttribute('disabled');
  }
  btnRecord.classList.remove('working');
  btnRecordSimple.classList.remove('working');
  if (!recordingBroken) {
    btnRecord.removeAttribute('disabled');
    btnRecordSimple.removeAttribute('disabled');
  }
}

function saveMidi(event) {
  event.stopImmediatePropagation();
  saveAs(new File([mm.sequenceProtoToMidi(visualizer.noteSequence)], 'transcription.mid'));
}

function loadMultitrack() {
  globalCompressor = new mm.Player.tone.MultibandCompressor();
  globalReverb = new mm.Player.tone.Freeverb(0.25);
  globalLimiter = new mm.Player.tone.Limiter();

  globalCompressor.connect(globalReverb);
  globalReverb.connect(globalLimiter);
  globalLimiter.connect(mm.Player.tone.Master);

  programMap = new Map();
  for (let i=0; i<128; i++) {
    const programCompressor = new mm.Player.tone.Compressor();
    const pan = 2 * MAX_PAN * Math.random() - MAX_PAN;
    const programPanner = new mm.Player.tone.Panner(pan);  
    programMap.set(i, programCompressor);
    programCompressor.connect(programPanner);
    programPanner.connect(globalCompressor);
  }

  drumMap = new Map();
  for (let i=MIN_DRUM; i<=MAX_DRUM; i++) {
    const drumCompressor = new mm.Player.tone.Compressor();
    const pan = 2 * MAX_PAN * Math.random() - MAX_PAN;
    const drumPanner = new mm.Player.tone.Panner(pan);
    drumMap.set(i, drumCompressor);
    drumCompressor.connect(drumPanner);  
    drumPanner.connect(globalCompressor);
  }
}

function NSynthLoaded(urls) {
  //console.log(urls);
}

function generateSample(doneCallback) {
  const z = tf.randomNormal([1, Z_DIM]);
  z.data().then(zArray => {
    z.dispose();
    doneCallback(zArray);
  });
}

// Generate chord progression for each alpha.
function generateProgressions(doneCallback) {
  let temp = [];
  for (let i=0; i<numSteps; i++) {
    temp.push([]);
  }
  generateInterpolations(0, temp, seqs => {
    chordSeqs = seqs;
    concatSeqs = chordSeqs.map(s => concatenateSequences(s));
    progSeqs = concatSeqs.map(seq => {
      const mergedSeq = mm.sequences.mergeInstruments(seq);
      const progSeq = mm.sequences.unquantizeSequence(mergedSeq);
      progSeq.ticksPerQuarter = STEPS_PER_QUARTER;
      return progSeq;
    });
    
    const fullSeq = concatenateSequences(concatSeqs);
    const mergedFullSeq = mm.sequences.mergeInstruments(fullSeq);

    let notes = [];
    for (let i = 0; i <= 128; i++) {
      notes.push({
        pitch:60,
        startTime:0,
        endTime: 1,
        instrument: i,
        isDrum: false,
        program: 0,
        quantizedEndStep: 2,
        quantizedStartStep: 1,
        velocity: 113
      });
    }
    let newSeq = new mm.NoteSequence({notes: notes, totalTime: 1})
    //playerMaster.loadSamples(mergedFullSeq)
    playerMaster.loadSamples(mergedFullSeq)
      .then(doneCallback);
  });  
}


// Interpolate the two styles for a single chord.
function interpolateSamples(chord, doneCallback) {
  const z1Tensor = tf.tensor2d(z1, [1, Z_DIM]);
  const z2Tensor = tf.tensor2d(z2, [1, Z_DIM]);
  const zInterp = slerp(z1Tensor, z2Tensor, numSteps);
  multitrack_chords.decode(zInterp, undefined, [chord], STEPS_PER_QUARTER)
    .then(sequences => doneCallback(sequences));
}

// Construct spherical linear interpolation tensor.
function slerp(z1, z2, n) {
  const norm1 = tf.norm(z1);
  const norm2 = tf.norm(z2);
  const omega = tf.acos(tf.matMul(tf.div(z1, norm1),
                                  tf.div(z2, norm2),
                                  false, true));
  const sinOmega = tf.sin(omega);
  const t1 = tf.linspace(1, 0, n);
  const t2 = tf.linspace(0, 1, n);
  const alpha1 = tf.div(tf.sin(tf.mul(t1, omega)), sinOmega).as2D(n, 1);
  const alpha2 = tf.div(tf.sin(tf.mul(t2, omega)), sinOmega).as2D(n, 1);
  const z = tf.add(tf.mul(alpha1, z1), tf.mul(alpha2, z2));
  return z;
}

// Generate interpolations for all chords.
function generateInterpolations(chordIndex, result, doneCallback) {
  if (chordIndex === numChords) {
    doneCallback(result);
  } else {
    interpolateSamples(chords[chordIndex], seqs => {
      for (let i=0; i<numSteps; i++) {
        result[i].push(seqs[i]);
      }
      generateInterpolations(chordIndex + 1, result, doneCallback);
    })
  }
}

// Concatenate multiple NoteSequence objects.
function concatenateSequences(seqs) {
  const seq = mm.sequences.clone(seqs[0]);
  let numSteps = seqs[0].totalQuantizedSteps;
  for (let i=1; i<seqs.length; i++) {
    const s = mm.sequences.clone(seqs[i]);
    s.notes.forEach(note => {
      note.quantizedStartStep += numSteps;
      note.quantizedEndStep += numSteps;
      seq.notes.push(note);
    });
    numSteps += s.totalQuantizedSteps;
  }
  seq.totalQuantizedSteps = numSteps;
  return seq;
}

// Randomly adjust note times.
function humanize(s) {
  const seq = mm.sequences.clone(s);
  seq.notes.forEach((note) => {
    let offset = HUMANIZE_SECONDS * (Math.random() - 0.5);
    if (seq.notes.startTime + offset < 0) {
      offset = -seq.notes.startTime;
    }
    if (seq.notes.endTime > seq.totalTime) {
      offset = seq.totalTime - seq.notes.endTime;
    }
    seq.notes.startTime += offset;
    seq.notes.endTime += offset;
  });
  return seq;
}

function createSong(callback, ns, idx, chordIdx, times, second) {
  const unquantizedSeq = mm.sequences.unquantizeSequence(chordSeqs[idx][chordIdx]);
  let humanized = humanize(unquantizedSeq);
  ns.push(humanized);
  second += 2;
  if (chordIdx == (numChords - 1)) {
    times = (times + 1) % numTimes;
    if (times == 0) {
      idx = (idx + 1) % numSteps;  
    }
  }
  chordIdx = (chordIdx + 1) % numChords;
  if (idx == 0 && chordIdx == 0 && times == 0) {
    let result = concatenateSequences(ns);
    callback([result, ns]);
  } else {
    createSong(callback, ns, idx, chordIdx, times, second);
  }
}

// Play the interpolated sequence for the current slider position.
function playProgression(idx, chordIdx, times) {  
  const unquantizedSeq = mm.sequences.unquantizeSequence(chordSeqs[idx][chordIdx]);
  let humanized = humanize(unquantizedSeq);
  playerMaster.start(humanized)
    .then(() => {
      if (chordIdx == (numChords - 1)) {
        times = (times + 1) % numTimes;
        if (times == 0) {
          idx = (idx + 1) % numSteps;  
        }
      }
      chordIdx = (chordIdx + 1) % numChords;
      playProgression(idx, chordIdx, times);
    });
}

// Save sequence as MIDI.
function saveSequence(ns) {
  const midi = mm.sequenceProtoToMidi(ns);
  const file = new Blob([midi], {type: 'audio/midi'});
    
  if (window.navigator.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(file, 'prog.mid');
  } else { // Others
    const a = document.createElement('a');
    const url = URL.createObjectURL(file);
    a.href = url;
    a.download = 'prog.mid';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);  
    }, 0); 
  }
}

function loadSequence() {
  exportSong(fullSong);
}

function sequenceToMidi(ns) {
    if (mm.sequences.isQuantizedSequence(ns)) {
        ns = mm.sequences.unquantizeSequence(ns);
    }
    if (!ns.tempos || ns.tempos.length === 0) {
        ns.tempos = [{ time: 0, qpm: mm.constants.DEFAULT_QUARTERS_PER_MINUTE }];
    }
    if (!ns.timeSignatures || ns.timeSignatures.length === 0) {
        ns.timeSignatures = [{ time: 0, numerator: 4, denominator: 4 }];
    }
    if (ns.tempos.length !== 1 || ns.tempos[0].time !== 0) {
        throw new MidiConversionError('NoteSequence must have exactly 1 tempo at time 0');
    }
    if (ns.timeSignatures.length !== 1 || ns.timeSignatures[0].time !== 0) {
        throw new MidiConversionError('NoteSequence must have exactly 1 time signature at time 0');
    }
    var json = {
        header: {
            bpm: ns.tempos[0].qpm,
            PPQ: ns.ticksPerQuarter ? ns.ticksPerQuarter :
                mm.constants.DEFAULT_TICKS_PER_QUARTER,
            timeSignature: [ns.timeSignatures[0].numerator, ns.timeSignatures[0].denominator]
        },
        tracks: []
    };
    var tracks = new Map();
    for (var _i = 0, _a = ns.notes; _i < _a.length; _i++) {
        var note = _a[_i];
        var instrument = note.instrument ? note.instrument : 0;
        if (!tracks.has(instrument)) {
            tracks.set(instrument, []);
        }
        tracks.get(instrument).push(note);
    }
    var instruments = Array.from(tracks.keys()).sort(function (a, b) { return a - b; });
    for (var i = 0; i < instruments.length; i++) {
        if (i !== instruments[i]) {
            throw new MidiConversionError('Instrument list must be continuous and start at 0');
        }
        var notes = tracks.get(i);
        var track = {
            id: i,
            notes: [],
            isPercussion: (notes[0].isDrum === undefined) ? false : notes[0].isDrum,
            channelNumber: notes[0].isDrum ? mm.constants.DRUM_CHANNEL :
                mm.constants.DEFAULT_CHANNEL,
            instrumentNumber: (notes[0].program === undefined) ?
                mm.constants.DEFAULT_PROGRAM :
                notes[0].program
        };
        track.notes = notes.map(function (note) {
            var velocity = (note.velocity === undefined) ?
                mm.constants.DEFAULT_VELOCITY :
                note.velocity;
            return {
                midi: note.pitch,
                time: note.startTime,
                duration: note.endTime - note.startTime,
                velocity: (velocity + 1) / mm.constants.MIDI_VELOCITIES
            };
        });
        json['tracks'].push(track);
    }
    var converted = MidiConvert.fromJSON(json);
    return converted;
}

function exportSong(ns) {
  let exportFormat = songToExportFormat(ns);
  let dataUrl = generateDataUrl(exportFormat);
  let hash = '#cmp=' + dataUrl;
  let url = '/daw/' + hash;
  if (inIframe()) {
    parent.DAW.addCompositionByURL( dataUrl ).catch( e => {
      console.error( e );
    }).then( cmp => {
      parent.DAW.openComposition( cmp.id );
      parent.gsuiPopup.style.visibility = 'hidden';
    } );
    //window.parent.location.assign(url);
    //history.replaceState(undefined, undefined, hash);
    //window.parent.location.reload();
  } else {
    window.open(url);  
  }
}

function songToExportFormat(ns) {
  let seq = sequenceToMidi(ns);
  let newSong = cloneObject(emptySong);
  newSong.id = guid();
  for (let i = 0; i < seq.tracks.length; i++) {
    let instNumber = seq.tracks[i].instrumentNumber;
    let track = seq.tracks[i];
    let keyName = 'k' + (i + 1);
    let synthName = 's' + (i + 1);
    let trackName = 't' + (i + 1);
    newSong.synths[synthName].instrument.id = instNumber;
    newSong.synths[synthName].instrument.isDrum = seq.tracks[i].isPercussion;
    newSong.synths[synthName].oscillators = {};
    if (seq.tracks[i].isPercussion) {
      newSong.synths[synthName].name = 'Drums';
      newSong.tracks[trackName].name = 'Drums';
      newSong.synths[synthName].oscillators['d' + instNumber] = { "order": 0, "type": "triangle", "detune": 0, "pan": -0.3, "gain": 0.46 };
    } else {
      let instrumentName = instrumentList[instNumber+''];
      newSong.synths[synthName].name = instrumentName;
      newSong.tracks[trackName].name = instrumentName;
      newSong.synths[synthName].oscillators['o' + instNumber] = { "order": 0, "type": "triangle", "detune": 0, "pan": -0.3, "gain": 0.46 };
    }
    for (let j = 0; j < track.notes.length; j++) {
      let note = track.notes[j];
      newSong.keys[keyName][''+j] = {
        "key": note.midi, "pan": 0, "gain": note.velocity, "duration": note.duration, "when": note.time
      };
    }
  }
  return newSong;
}

function generateDataUrl(obj) {
  let dataUrl = 'data:text/html;base64,' + btoa(JSON.stringify(obj));
  return dataUrl;
}

function guid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}

function getProbableChordsFromNotes(scale, notes) {
  let chordServe = new Chordserve();
  let results = chordServe.randomSelect(scale, notes);
  return results;
}

function inIframe() {
    try {
        return window.self !== window.top;
    } catch (e) {
        return true;
    }
}

function getMaxId(arr) {
  let maxId = 0;
  let maxVal = arr[0];
  for(let i = 1; i < arr.length; i++) {
    if(arr[i] > maxVal) {
      maxVal = arr[i];
      maxId = i;
    }
  }
  return maxId;
}

function sequenceToVector(ns) {
  const num_bars = 2; 
  const beat_resolution = 8;
  const beats_per_bar = 4;
  const min_pitch = 12;
  const max_pitch = 96;
  const beats = beats_per_bar * num_bars;
  const step_size = 1 / beat_resolution;
  const vector_size = beats_per_bar * beat_resolution * num_bars;
  const sequence_steps = parseInt(ns.notes[ns.notes.length - 1].endTime / step_size);
  let vector = new Array(vector_size).fill(0);
  for (let note of ns.notes) {
    let start_step = parseInt(note.startTime / step_size);
    let duration = parseInt((note.endTime - note.startTime) / step_size);
    if (duration <= 0) {
      duration = 1;
    }
    let end_step = start_step + duration;
    if (start_step > vector_size) {
      break;
    }
    if (end_step > vector_size) {
      end_step = vector_size;
    }
    for (let i = start_step; i < end_step; i++) {
      if (note.pitch >= min_pitch && note.pitch <= max_pitch) {
        vector[i] = note.pitch;
      }
    }
  }
  return vector;
}

function processSong() {
  return new Promise((resolve, reject) => {
    generateProgressions(() => {
      createSong((ns) => {
        resolve(ns);
      }, [], 0, 0, 0, 0);
    });
  });
}

function encodeSong(ns) {
  return new Promise((resolve, reject) => {
    let qns = mm.sequences.quantizeNoteSequence(ns, STEPS_PER_QUARTER);
    multitrack_chords.encode([qns], [chords[0]]).then((z) => {
      z.data().then(zArray => {
        z.dispose();
        resolve(zArray);
      });
    });
  });
}

async function predict_genre(vector) {
  if(typeof vector == 'undefined') {
    vector = [[64., 64., 64., 64., 64., 64., 64., 64., 54., 54., 54., 54., 54., 54., 54., 54., 59., 59., 59., 59., 59., 59., 59., 59., 64., 64., 64., 64., 64., 64., 64., 64., 59., 59., 59., 59., 59., 59., 59., 59., 54., 54., 54., 54., 54., 54., 54., 54., 64., 64., 64., 64., 64., 64., 64., 64., 57., 57., 57., 57., 57., 57., 57., 57.]];
    //vector0 = [[54., 54., 54.,  0., 52., 52., 52.,  0., 50., 50., 50.,  0., 54., 54.,  0.,  0., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 52., 0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0., 50.,  0., 49.,  0., 50.,  0., 49.,  0., 50., 50., 50.,  0., 50.,  0., 49.,  0.]];
    //vector1 = [[31., 31., 31., 31.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0., 0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0., 48., 48., 48., 48., 48., 48., 48., 48., 48., 48., 48., 48.,  0.,  0.,  0., 0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0., 48., 48., 48., 48., 48., 48., 48., 48.,  0.,  0.,  0.,  0.]];
    //vector2 = [[52., 52., 52., 52., 50., 50., 50., 50., 50., 50., 50., 50., 52., 52., 52., 52., 52., 52., 52., 52.,  0.,  0.,  0.,  0.,  0.,  0., 0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0.,  0., 0.,  0.,  0.,  0.,  0., 47., 47., 47., 47., 47., 47., 47., 47., 45., 45., 45., 45., 45., 45., 45., 45.,  0.,  0.,  0.,  0.]];
  }
  const genres = ['electronic', 'rock', 'jazz'];
  const model = await tf.loadModel('assets/models/genre/model.json');
  const example = tf.tensor(vector);
  const prediction = model.predict(example);
  const readable_output = prediction.dataSync();
  const idx = getMaxId(readable_output);
  const genre = genres[idx];
  return [genre, readable_output, genres];
}

function forceDownloadFile(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sound.wav';
  document.body.appendChild(a);
  a.click();
}

function downloadWav() {
  const midi = mm.sequenceProtoToMidi(fullSong);
  const file = new Blob([midi], {type: 'audio/midi'});
  var reader = new FileReader();

  // set callback for array buffer
  reader.addEventListener('load', function load(event) {
    // convert midi arraybuffer to wav blob
    var wav = midiToWav(event.target.result, {verbose: true}).toBlob();
    // create a temporary URL to the wav file
    var src = URL.createObjectURL(wav);
    forceDownloadFile(src);
  });

  // read the file as an array buffer
  reader.readAsArrayBuffer(file);
}

function getDrum(genre, drumKick, drumHit) {
  let drum = {notes: [], quantizationInfo: { stepsPerQuarter: 4 }, totalQuantizedSteps: 30 };
  if (genre == 'electronic') {
    drum.notes = [
        { pitch: drumKick, quantizedStartStep: 0, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 2, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 4, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 6, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 8, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 10, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 12, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 14, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 16, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 18, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 20, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 22, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 24, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 26, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 28, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 30, instrument: 2, isDrum: true }
    ];
  } else if (genre == 'rock') {
    drum.notes = [
        { pitch: drumKick, quantizedStartStep: 0, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 2, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 4, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 6, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 8, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 10, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 12, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 14, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 16, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 18, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 20, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 22, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 24, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 26, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 28, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 30, instrument: 2, isDrum: true }
    ];
  } else if (genre == 'jazz') {
    drum.notes = [
        { pitch: drumHit, quantizedStartStep: 0, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 0, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 4, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 7, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 8, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 8, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 12, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 15, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 16, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 16, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 20, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 23, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 24, instrument: 2, isDrum: true },
        { pitch: drumKick, quantizedStartStep: 24, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 28, instrument: 2, isDrum: true },
        { pitch: drumHit, quantizedStartStep: 31, instrument: 2, isDrum: true }  
    ];
  }
  return drum;
}

/*
 * CLASSES
 */

class Chordserve {
    constructor() {

        this.keys = {
            ionian: {
                rules: "wwhwwwh"
            },
            lydian: {
                rules: "wwwhwwh"
            },
            mixolydian: {
                rules: "wwhwwww"
            },
            dorian: {
                rules: "whwwwhw"
            },
            aeolian: {
                rules: "whwwhww"
            },
            phrygian: {
                rules: "hwwwwhw"
            },
            locrian: {
                rules: "hwwhxhw"
            },
            harmonic_minor: {
                rules: "whwwhxh"
            },
            melodic_minor: {
                rules: "whwwwwh"
            },
            major_pentatonic: {
               rules: "wwxwx" 
            },
            minor_pentatonic: {
                rules: "xwwxw"
            },
            minor_blues: {
                rules: "xwhhxw"
            }
        };

        this.intervalArr = [
            "I", "II", "III", "IV", "V", "VI", "VII"
        ];

        this.progressions = [
            ["I", "VImin", "IImin", "V"],
            ["IIImin", "VImin", "IImin", "V"],
            ["I", "IImin", "IIImin", "IV"],
            ["Imin", "bVII", "bVI", "bVII"],
            ["Imin", "bVII", "bVI", "V"],
            ["Imin", "IImin", "bIII", "IImin"]
        ];

        this.notes = [
            "Ab", "A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G"
        ];
        this.key_notes = [];
    }

    createTriad(rootNote, addTriad) {
        var triad = []
        var key_notes = this.generateKey(rootNote, "major");
        triad.push(rootNote);
        triad.push(key_notes[3-1])
        triad.push(key_notes[5-1])

        var extraN = null;
        var noteIndex = null;

        if(addTriad === "min"){
            var n = triad[1]
            noteIndex = this.notes.indexOf(n);
            if (noteIndex > 0) {
                noteIndex--;
            } else {
                noteIndex = this.notes.length - 1;
            }
            triad[1] = this.notes[noteIndex];
        }

        if(addTriad === "7" && key_notes.length >= 7) {
           extraN = key_notes[7-1];
           noteIndex = this.notes.indexOf(extraN);
           if (noteIndex > 0) {
               noteIndex--;
           } else {
               noteIndex = this.notes.length - 1;
           }
           triad.push(noteIndex);
        }

        if(addTriad === "M7" && key_notes.length >= 7) {
           extraN = key_notes[7-1];
           noteIndex = this.notes.indexOf(extraN);
           triad.push(noteIndex);
        }

        return triad;
    }

    convertIntervalToChord(interval, keyNotes) {
        var accidentals = ["b", "#", "7", "M7", "min"];
        var usedAcc = [];
        var parsedInterval = interval;
        accidentals.map(i => {
            if (parsedInterval.indexOf(i) > -1)
                usedAcc.push(i)
            parsedInterval = parsedInterval.replace(i, "")
            return null;
        })
        var intervalIndex = this.intervalArr.indexOf(parsedInterval);
        // intervalIndex += 1
        if(usedAcc.indexOf("b") > 0) {
            if (intervalIndex === 0) {
                intervalIndex--;
            } else {
                intervalIndex = this.intervalArr.length - 1;
            }
        } 
        if(usedAcc.indexOf("#") >= 0) {
            if (intervalIndex === (this.intervalArr.length - 1)) {
                intervalIndex++;
            } else {
                intervalIndex = this.intervalArr.length - 1;
            }
        }

        var addTriad = "";
        accidentals.slice(2).forEach((acc, idx, arr) => {
            if(usedAcc.indexOf(acc) >= 0) {
                addTriad = acc;
                return
            } 
        })
        var rootNote = keyNotes[intervalIndex];
        if (rootNote === undefined) {
            return null;
        } else {
            var triad = this.createTriad(rootNote, addTriad)
            return [interval, triad]
        }
    }

    toTitleCase(str) {
        return str.toLowerCase()
          .split(' ')
          .map(i => i[0].toUpperCase() + i.substring(1))
          .join(' ')
    }

    convertToKeyIndex(keyString) {
        return keyString.toLowerCase().split(' ').join('_');
    }

    generateKey(note, key) {
        note = note.length === 1 ? note.toUpperCase() : this.toTitleCase(note);
        var key_notes = [note];
        var root_index = this.notes.indexOf(note)
        var index = root_index

        let key_index = this.convertToKeyIndex(key);
        if (key_index === 'minor') {
            key_index = 'aeolian';
        }
        if (key_index === 'major') {
            key_index = 'ionian';
        }
        var k = this.keys[key_index];
        // generate notes and chords
        // first notes
        var dist;
        for(var step of Array.from(k.rules)) {
            if (step === "w") {
                dist = 2
            } else if (step === "h") {
                dist = 1
            } else if (step === "x") {
                dist = 3
            }

            var new_index = index + dist
            if (new_index >= this.notes.length) {
                index = new_index - this.notes.length;
            } else {
                index = new_index
            }

            key_notes.push(this.notes[index])
        }

        return key_notes;

    }

    randomSelect(note, extras) {
        // on select key
        var max = 0;
        var exit = [];
        var notesArr = this.notes;
        //var note = notesArr[Math.floor(Math.random() * notesArr.length)];
        let keyList = Object.keys(this.keys);
        for (let scale of keyList) {
            //var scale = keyList[Math.floor(Math.random() * keyList.length)];
            let key_notes = this.generateKey(note, scale);
            for (let randomProg of this.progressions) {
                //var randomProg = this.progressions[Math.floor(Math.random() * this.progressions.length)];
                var progressionObj = [];
                // go through intervals
                for (let interval of randomProg) {
                    var results = this.convertIntervalToChord(interval, key_notes);
                    if (results != null) {
                        var triad = results[1];
                        var chord = triad[0];
                        if (interval.indexOf('min') != -1) {
                            chord += 'm';
                        }
                        progressionObj.push([interval,triad,chord]);
                    }              
                }
                if (progressionObj.length == 4) {
                    let cont = 0;
                    if (progressionObj[0][1].indexOf(extras[0]) != -1)
                       cont++;
                    if (progressionObj[1][1].indexOf(extras[1]) != -1)
                       cont++;
                    if (progressionObj[2][1].indexOf(extras[2]) != -1)
                       cont++;
                    if (progressionObj[3][1].indexOf(extras[3]) != -1)
                       cont++;
                    if (cont > max) {
                        exit = [];
                        max = cont;
                    }
                    if (cont == max) {
                        exit.push([
                          progressionObj[0][2],
                          progressionObj[1][2],
                          progressionObj[2][2],
                          progressionObj[3][2]
                        ]);
                    }
                }
            }
        }
        return exit;
    }
}

/*
 * CATALOGS
 */

var emptySong = {
  "id": "88fb1290-76e2-4aa1-be2b-0e1dd62226bb",
  "bpm": 120,
  "stepsPerBeat": 4,
  "beatsPerMeasure": 4,
  "name": "AI Demo",
  "duration": 128,
  "patterns": {
    "p1": { "name": "", "type": "keys", "keys": "k1", "synth": "s1", "instrument": "i1", "duration": 128 },
    "p2": { "name": "", "type": "keys", "keys": "k2", "synth": "s2", "instrument": "i2", "duration": 128 },
    "p3": { "name": "", "type": "keys", "keys": "k3", "synth": "s3", "instrument": "i3", "duration": 128 },
    "p4": { "name": "", "type": "keys", "keys": "k4", "synth": "s4", "instrument": "i4", "duration": 128 },
    "p5": { "name": "", "type": "keys", "keys": "k5", "synth": "s5", "instrument": "i5", "duration": 128 },
    "p6": { "name": "", "type": "keys", "keys": "k6", "synth": "s6", "instrument": "i6", "duration": 128 },
    "p7": { "name": "", "type": "keys", "keys": "k7", "synth": "s7", "instrument": "i7", "duration": 128 },
    "p8": { "name": "", "type": "keys", "keys": "k8", "synth": "s8", "instrument": "i8", "duration": 128 }
  },
  "synths": {
    "s1": {
      "name": "",
      "instrument": { "id": 1, "name": "instrument1", "isDrum": false },
      "oscillators": {
        "o1": { "order": 0, "type": "triangle", "detune": 0, "pan": -0.3, "gain": 0.46 }
      }
    },
    "s2": {
      "name": "",
      "instrument": { "id": 2, "name": "instrument2", "isDrum": false },
      "oscillators": {
        "o2": { "order": 0, "type": "triangle", "detune": 0, "pan": -0.3, "gain": 0.46 }
      }
    },
    "s3": {
      "name": "",
      "instrument": { "id": 3, "name": "instrument3", "isDrum": false },
      "oscillators": {
        "o3": { "order": 0, "type": "triangle", "detune": 0, "pan": -0.3, "gain": 0.46 }
      }
    },
    "s4": {
      "name": "",
      "instrument": { "id": 4, "name": "instrument4", "isDrum": false },
      "oscillators": {
        "o4": { "order": 0, "type": "triangle", "detune": 0, "pan": -0.3, "gain": 0.46 }
      }
    },
    "s5": {
      "name": "",
      "instrument": { "id": 5, "name": "instrument5", "isDrum": false },
      "oscillators": {
        "o5": { "order": 0, "type": "triangle", "detune": 0, "pan": -0.3, "gain": 0.46 }
      }
    },
    "s6": {
      "name": "",
      "instrument": { "id": 6, "name": "instrument6", "isDrum": false },
      "oscillators": {
        "o6": { "order": 0, "type": "triangle", "detune": 0, "pan": -0.3, "gain": 0.46 }
      }
    },
    "s7": {
      "name": "",
      "instrument": { "id": 7, "name": "instrument7", "isDrum": false },
      "oscillators": {
        "o7": { "order": 0, "type": "triangle", "detune": 0, "pan": -0.3, "gain": 0.46 }
      }
    },
    "s8": {
      "name": "",
      "instrument": { "id": 8, "name": "instrument8", "isDrum": false },
      "oscillators": {
        "o8": { "order": 0, "type": "triangle", "detune": 0, "pan": -0.3, "gain": 0.46 }
      }
    }
  },
  "tracks": {
    "t1": { "order": 0, "name": "" },
    "t2": { "order": 1, "name": "" },
    "t3": { "order": 2, "name": "" },
    "t4": { "order": 3, "name": "" },
    "t5": { "order": 4, "name": "" },
    "t6": { "order": 5, "name": "" },
    "t7": { "order": 6, "name": "" },
    "t8": { "order": 7, "name": "" }
  },
  "blocks": {
    "0": { "pattern": "p1", "duration": 128, "when": 0, "track": "t1" },
    "1": { "pattern": "p2", "duration": 128, "when": 0, "track": "t2" },
    "2": { "pattern": "p3", "duration": 128, "when": 0, "track": "t3" },
    "3": { "pattern": "p4", "duration": 128, "when": 0, "track": "t4" },
    "4": { "pattern": "p5", "duration": 128, "when": 0, "track": "t5" },
    "5": { "pattern": "p6", "duration": 128, "when": 0, "track": "t6" },
    "6": { "pattern": "p7", "duration": 128, "when": 0, "track": "t7" },
    "7": { "pattern": "p8", "duration": 128, "when": 0, "track": "t8" }
  },
  "keys": {
    "k1": {
      "0": { "key": 50, "pan": 0, "gain": 0.8, "duration": 1, "when": 0 }
    },
    "k2": {
      "0": { "key": 51, "pan": 0, "gain": 0.8, "duration": 1, "when": 0 }
    },
    "k3": {
      "0": { "key": 52, "pan": 0, "gain": 0.8, "duration": 1, "when": 0 }
    },
    "k4": {
      "0": { "key": 53, "pan": 0, "gain": 0.8, "duration": 1, "when": 0 }
    },
    "k5": {
      "0": { "key": 54, "pan": 0, "gain": 0.8, "duration": 1, "when": 0 }
    },
    "k6": {
      "0": { "key": 55, "pan": 0, "gain": 0.8, "duration": 1, "when": 0 }
    },
    "k7": {
      "0": { "key": 56, "pan": 0, "gain": 0.8, "duration": 1, "when": 0 }
    },
    "k8": {
      "0": { "key": 57, "pan": 0, "gain": 0.8, "duration": 1, "when": 0 }
    }
  },
  "synthOpened": "s1",
  "savedAt": 1534026524,
  "patternOpened": "p1"
};

var allNoteLetters = {
  'C': 36, 'C#': 37, 'D': 38, 'D#': 39, 'E': 40, 'F': 41,
  'F#': 42, 'G': 43, 'G#': 44, 'A': 45, 'A#': 46, 'B': 47,
  'Db': 37, 'Eb': 39, 'Gb': 42, 'Ab': 44, 'Bb': 46
};
var allNotes = Object.keys(allNoteLetters);

var chordsFromNote = {
  'C' : ['C','Cm','F','Fm','G#', 'Am'],
  'D' : ['D','Dm','G','Gm','A#', 'Bm'],
  'E' : ['E','Em','A','Am','C' , 'C#m'],
  'F' : ['F','Fm','B','Bm','C#', 'Dm'],
  'G' : ['G','Gm','C','Cm','D#', 'Em'],
  'A' : ['A','Am','D','Dm','F' , 'F#m'],
  'B' : ['B','Bm','E','Em','G' , 'G#m'],
  'C#': ['C#','C#m','F#','F#m','A','A#m'],
  'D#': ['D#','D#m','B','Cm','G#','G#m'],
  'F#': ['F#','F#m','B','Bm','D','D#m'],
  'G#': ['G#','G#m','E','C#','C#m','Fm'],
  'A#': ['A#','A#m','D#','D#m','F#','Gm']
}

const instrumentList = {
  "0": "acoustic_grand_piano", "1": "bright_acoustic_piano",
  "2": "electric_grand_piano", "3": "honkytonk_piano",
  "4": "electric_piano_1", "5": "electric_piano_2",
  "6": "harpsichord", "7": "clavichord", "8": "celesta",
  "9": "glockenspiel", "10": "music_box", "11": "vibraphone",
  "12": "marimba", "13": "xylophone", "14": "tubular_bells",
  "15": "dulcimer", "16": "drawbar_organ", "17": "percussive_organ",
  "18": "rock_organ", "19": "church_organ", "20": "reed_organ",
  "21": "accordion", "22": "harmonica", "23": "tango_accordion",
  "24": "acoustic_guitar_nylon", "25": "acoustic_guitar_steel",
  "26": "electric_guitar_jazz", "27": "electric_guitar_clean",
  "28": "electric_guitar_muted", "29": "overdriven_guitar",
  "30": "distortion_guitar", "31": "guitar_harmonics",
  "32": "acoustic_bass", "33": "electric_bass_finger",
  "34": "electric_bass_pick", "35": "fretless_bass",
  "36": "slap_bass_1", "37": "slap_bass_2", "38": "synth_bass_1",
  "39": "synth_bass_2", "40": "violin", "41": "viola",
  "42": "cello", "43": "contrabass", "44": "tremolo_strings",
  "45": "pizzicato_strings", "46": "orchestral_harp", "47": "timpani",
  "48": "string_ensemble_1", "49": "string_ensemble_2",
  "50": "synthstrings_1", "51": "synthstrings_2", "52": "choir_aahs",
  "53": "voice_oohs", "54": "synth_voice", "55": "orchestra_hit",
  "56": "trumpet", "57": "trombone", "58": "tuba",
  "59": "muted_trumpet", "60": "french_horn", "61": "brass_section",
  "62": "synthbrass_1", "63": "synthbrass_2", "64": "soprano_sax",
  "65": "alto_sax", "66": "tenor_sax", "67": "baritone_sax",
  "68": "oboe", "69": "english_horn", "70": "bassoon", "71": "clarinet",
  "72": "piccolo", "73": "flute", "74": "recorder", "75": "pan_flute",
  "76": "blown_bottle", "77": "shakuhachi", "78": "whistle",
  "79": "ocarina", "80": "lead_1_square", "81": "lead_2_sawtooth",
  "82": "lead_3_calliope", "83": "lead_4_chiff", "84": "lead_5_charang",
  "85": "lead_6_voice", "86": "lead_7_fifths", "87": "lead_8_bass_lead",
  "88": "pad_1_new_age", "89": "pad_2_warm", "90": "pad_3_polysynth",
  "91": "pad_4_choir", "92": "pad_5_bowed", "93": "pad_6_metallic",
  "94": "pad_7_halo", "95": "pad_8_sweep", "96": "fx_1_rain",
  "97": "fx_2_soundtrack", "98": "fx_3_crystal", "99": "fx_4_atmosphere",
  "100": "fx_5_brightness", "101": "fx_6_goblins", "102": "fx_7_echoes",
  "103": "fx_8_scifi", "104": "sitar", "105": "banjo", "106": "shamisen",
  "107": "koto", "108": "kalimba", "109": "bag_pipe", "110": "fiddle",
  "111": "shanai", "112": "tinkle_bell", "113": "agogo",
  "114": "steel_drums", "115": "woodblock", "116": "taiko_drum",
  "117": "melodic_tom", "118": "synth_drum", "119": "reverse_cymbal",
  "120": "guitar_fret_noise", "121": "breath_noise", "122": "seashore",
  "123": "bird_tweet", "124": "telephone_ring", "125": "helicopter",
  "126": "applause", "127": "gunshot", "drums": "percussion"
};

/*
 * RUN APP
 */

init();