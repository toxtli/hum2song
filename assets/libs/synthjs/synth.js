'use strict';

// utility class to calculate time from delta ticks
// when MIDI file has several `setTempo` events
class Timer {
  constructor(ticksPerBeat) {
    this.ticksPerBeat = ticksPerBeat;
    this.criticalPoints = [];
  }

  // delta represents ticks since last time change
  addCriticalPoint(delta, microsecondsPerBeat) {
    this.criticalPoints.push({
      delta,
      microsecondsPerBeat
    });
  }

  getTime(delta) {
    const microsecondsPerSecond = 1000000;
    let time = 0;
    // midi standard initializes file with this value
    let microsecondsPerBeat = 500000;

    // iterate through time changes while decrementing delta ticks to 0
    for (let i = 0, criticalPoint; i < this.criticalPoints.length && delta > 0; i++) {
      criticalPoint = this.criticalPoints[i];

      // incrementally calculate the time passed for each range of timing
      if (delta >= criticalPoint.delta) {
        time += criticalPoint.delta * microsecondsPerBeat / this.ticksPerBeat / microsecondsPerSecond;
        delta -= criticalPoint.delta;
      } else {
        time += delta * microsecondsPerBeat / this.ticksPerBeat / microsecondsPerSecond;
        delta = 0;
      }

      microsecondsPerBeat = criticalPoint.microsecondsPerBeat;
    }

    time += delta * microsecondsPerBeat / this.ticksPerBeat / microsecondsPerSecond;

    return time;
  }
};

class MIDIStream {
  constructor(buffer) {
    this.data = new Uint8Array(buffer);
    this.byteOffset = 0;
    this.lastEventTypeByte = 0x00;
  }

  readString(byteLength) {
    var byteOffset = this.byteOffset;

    for (var i = 0, str = ''; i < byteLength; i++) {
      str += String.fromCharCode(this.data[byteOffset + i]);
    }

    this.byteOffset += byteLength;

    return str;
  }

  readUint32() {
    var byteOffset = this.byteOffset;
    var value = (
      (this.data[byteOffset    ] << 24) |
      (this.data[byteOffset + 1] << 16) |
      (this.data[byteOffset + 2] <<  8) |
      (this.data[byteOffset + 3]      )
    );

    this.byteOffset += 4;

    return value;
  }

  readUint24() {
    var byteOffset = this.byteOffset;
    var value = (
      (this.data[byteOffset    ] << 16) |
      (this.data[byteOffset + 1] <<  8) |
      (this.data[byteOffset + 2]      )
    );

    this.byteOffset += 3;

    return value;
  }

  readUint16() {
    var byteOffset = this.byteOffset;
    var value = (
      (this.data[byteOffset    ] << 8) |
      (this.data[byteOffset + 1]     )
    );

    this.byteOffset += 2;

    return value;
  }

  readUint8() {
    var byteOffset = this.byteOffset;
    var value = this.data[byteOffset];

    this.byteOffset += 1;

    return value;
  }

  readInt8() {
    var byteOffset = this.byteOffset;
    var value = this.data[byteOffset];

    if (value & 0x80 === 0x80) {
      value ^= 0xFFFFFF00;
    }

    this.byteOffset += 1;

    return value;
  }

  readVarUint() {
    var value = 0;
    var uint8;

    do {
      uint8 = this.readUint8();
      value = (value << 7) + (uint8 & 0x7F);
    } while ((uint8 & 0x80) === 0x80);

    return value;
  }

  skip(byteLength) {
    this.byteOffset += byteLength;
  }

  readChunk() {
    var id = this.readString(4);
    var length = this.readUint32();
    var byteOffset = this.byteOffset;

    this.byteOffset += length;

    var data = this.data.slice(byteOffset, this.byteOffset);

    return {
      id: id,
      length: length,
      data: data.buffer
    };
  }

  readEvent() {
    var event = {};

    event.delta = this.readVarUint();

    var eventTypeByte = this.readUint8();

    // system event
    if ((eventTypeByte & 0xF0) === 0xF0) {
      switch (eventTypeByte) {
      // meta event
      case 0xFF:
        event.type = 'meta';

        var subTypeByte = this.readUint8();
        var length = this.readVarUint();

        switch (subTypeByte) {
        case 0x00:
          event.subType = 'sequenceNumber';
          if (length === 2)
            event.value = this.readUint16();
          else
            this.skip(length);
          break;
        case 0x01:
          event.subType = 'text';
          event.value = this.readString(length);
          break;
        case 0x02:
          event.subType = 'copyrightNotice';
          event.value = this.readString(length);
          break;
        case 0x03:
          event.subType = 'trackName';
          event.value = this.readString(length);
          break;
        case 0x04:
          event.subType = 'instrumentName';
          event.value = this.readString(length);
          break;
        case 0x05:
          event.subType = 'lyrics';
          event.value = this.readString(length);
          break;
        case 0x06:
          event.subType = 'marker';
          event.value = this.readString(length);
          break;
        case 0x07:
          event.subType = 'cuePoint';
          event.value = this.readString(length);
          break;
        case 0x20:
          event.subType = 'midiChannelPrefix';
          if (length === 1)
            event.value = this.readUint8();
          else
            this.skip(length);
          break;
        case 0x2F:
          event.subType = 'endOfTrack';
          if (length > 0)
            this.skip(length);
          break;
        case 0x51:
          event.subType = 'setTempo';
          if (length === 3)
            event.value = this.readUint24();
          else
            this.skip(length)
          break;
        case 0x54:
          event.subType = 'smpteOffset';
          if (length === 5) {
            var hourByte = this.readUint8();
            event.value = {
              frameRate: ({
                0x00: 24,
                0x01: 25,
                0x02: 29.97,
                0x03: 30
              }[hourByte >>> 6]),
              hour: (hourByte & 0x3F),
              minute: this.readUint8(),
              second: this.readUint8(),
              frame: this.readUint8(),
              subFrame: this.readUint8()
            };
          } else {
            this.skip(length);
          }
          break;
        case 0x58:
          event.subType = 'timeSignature';
          if (length === 4) {
            event.value = {
              numerator: this.readUint8(),
              denominator: 1 << this.readUint8(),
              metronome: this.readUint8(),
              thirtyseconds: this.readUint8()
            };
          } else {
            this.skip(length);
          }
          break;
        case 0x59:
          event.subType = 'keySignature';
          if (length === 2) {
            event.value = {
              key: this.readInt8(),
              scale: this.readUint8()
            };
          } else {
            this.skip(length);
          }
          break;
        case 0x7F:
          event.subType = 'sequencerSpecific';
          event.value = this.readString(length);
          break;
        default:
          event.subType = 'unknown';
          event.value = this.readString(length);
        }
        break;
      // sysex event
      case 0xF0:
        event.type = 'sysEx';

        var length = this.readVarUint();

        event.value = this.readString(length);

        break;
      case 0xF7:
        event.type = 'dividedSysEx';

        var length = this.readVarUint();

        event.value = this.readString(length);

        break;
      default:
        event.type = 'unknown';

        var length = this.readVarUint();

        event.value = this.readString(length);
      }
    // channel event
    } else {
      var param;

      // if the high bit is low
      // use running event type mode
      if ((eventTypeByte & 0x80) === 0x00) {
        param = eventTypeByte;
        eventTypeByte = this.lastEventTypeByte;
      } else {
        param = this.readUint8();
        this.lastEventTypeByte = eventTypeByte;
      }

      var eventType = eventTypeByte >> 4;

      event.channel = eventTypeByte & 0x0F;
      event.type = 'channel';

      switch (eventType) {
      case 0x08:
        event.subType = 'noteOff';

        event.value = {
          noteNumber: param,
          velocity: this.readUint8()
        };
        break;
      case 0x09:
        event.value = {
          noteNumber: param,
          velocity: this.readUint8()
        };

        // some midi implementations use a noteOn
        // event with 0 velocity to denote noteOff
        if (event.value.velocity === 0) {
          event.subType = 'noteOff';
        } else {
          event.subType = 'noteOn';
        }
        break;
      case 0x0A:
        event.subType = 'noteAftertouch';

        event.value = {
          noteNumber: param,
          amount: this.readUint8()
        };
        break;
      case 0x0B:
        event.subType = 'controller';

        event.value = {
          controllerNumber: param,
          controllerValue: this.readUint8()
        };
        break;
      case 0x0C:
        event.subType = 'programChange';
        event.value = param;
        break;
      case 0x0D:
        event.subType = 'channelAftertouch';
        event.value = param;
        break;
      case 0x0E:
        event.subType = 'pitchBend';
        event.value = param + (this.readUint8() << 7);
        break;
      default:
        event.subType = 'unknown';
        event.value = (param << 8) + this.readUint8();
      }
    }

    return event;
  }
};

class WAV {
  static semitone(note = 'REST') {
    // matches occurence of A through G
    // followed by positive or negative integer
    // followed by 0 to 2 occurences of flat or sharp
    const re = /^([A-G])(\-?\d+)(b{0,2}|#{0,2})$/;

    // if semitone is unrecognized, assume REST
    if (!re.test(note)) {
      return -Infinity;
    }

    // parse substrings of note
    const [, tone, octave, accidental] = note.match(re);

    // semitone indexed relative to A4 == 69 for compatibility with MIDI
    const tones = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
    const octaves = {'-1': 0, 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 10: 11};
    const accidentals = {bb: -2, b: -1, '': 0, '#': 1, '##': 2};

    // if semitone is unrecognized, assume REST
    if (tones[tone] === undefined || octaves[octave] === undefined || accidentals[accidental] === undefined) {
      return -Infinity;
    }

    // return calculated index
    return tones[tone] + octaves[octave] * 12 + accidentals[accidental];
  }

  static note(semitone = -Infinity) {
    const octaves = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const tones = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    const octaveIndex = Math.floor(semitone / 12);
    const toneIndex = Math.floor(semitone - octaveIndex * 12);

    const octave = octaves[octaveIndex];
    const tone = tones[toneIndex];

    // by default assume REST
    if (octave === undefined || tone === undefined) {
      return 'REST';
    }

    // tone followed by octave followed by accidental
    return tone.charAt(0) + octave.toString() + tone.charAt(1);
  }

  // converts semitone index to frequency in Hz
  static frequency(semitone = -Infinity) {
    // A4 is 440 Hz, 12 semitones per octave
    return 440 * Math.pow(2, (semitone - 69) / 12);
  }

  constructor(numChannels = 1, sampleRate = 44100, bitsPerSample = 16, littleEndian = true, data = []) {
    var bytesPerSample = bitsPerSample >>> 3;
    // WAV header is always 44 bytes
    this.header = new ArrayBuffer(44);
    // flexible container for reading / writing raw bytes in header
    this.view = new DataView(this.header);
    // leave sound data as non typed array for more flexibility
    this.data = data;

    // initialize as non-configurable because it
    // causes script to freeze when using parsed
    // chunk sizes with wrong endianess assumed
    Object.defineProperty(this, 'littleEndian', {
      configurable: false,
      enumerable: true,
      value: littleEndian,
      writable: false
    });

    // initial write index in data array
    this.pointer = 0;

    // WAV header properties
    this.ChunkID = littleEndian ? 'RIFF' : 'RIFX';
    this.ChunkSize = this.header.byteLength - 8;
    this.Format = 'WAVE';
    this.SubChunk1ID = 'fmt ';
    this.SubChunk1Size = 16;
    this.AudioFormat = 1;
    this.NumChannels = numChannels;
    this.SampleRate = sampleRate;
    this.ByteRate = numChannels * sampleRate * bytesPerSample;
    this.BlockAlign = numChannels * bytesPerSample;
    this.BitsPerSample = bitsPerSample;
    this.SubChunk2ID = 'data';
    this.SubChunk2Size = data.length * bytesPerSample;
  }

  // internal setter for writing strings as raw bytes to header
  setString(str, byteLength = str.length, byteOffset = 0) {
    for (var i = 0; i < byteLength; i++) {
      this.view.setUint8(byteOffset + i, str.charCodeAt(i));
    }
  }

  // internal getter for reading raw bytes as strings from header
  getString(byteLength, byteOffset = 0) {
    for (var i = 0, str = ''; i < byteLength; i++) {
      str += String.fromCharCode(this.view.getUint8(byteOffset + i));
    }

    return str;
  }

  // header property mutators

  // 4 bytes at offset of 0 bytes
  set ChunkID(str) {
    this.setString(str, 4, 0);
  }

  get ChunkID() {
    return this.getString(4, 0);
  }

  // 4 bytes at offset of 4 bytes
  set ChunkSize(uint) {
    this.view.setUint32(4, uint, this.littleEndian);
  }

  get ChunkSize() {
    return this.view.getUint32(4, this.littleEndian);
  }

  // 4 bytes at offset of 8 bytes
  set Format(str) {
    this.setString(str, 4, 8);
  }

  get Format() {
    return this.getString(4, 8);
  }

  // 4 bytes at offset of 12 bytes
  set SubChunk1ID(str) {
    this.setString(str, 4, 12);
  }

  get SubChunk1ID() {
    return this.getString(4, 12);
  }

  // 4 bytes at offset of 16 bytes
  set SubChunk1Size(uint) {
    this.view.setUint32(16, uint, this.littleEndian);
  }

  get SubChunk1Size() {
    return this.view.getUint32(16, this.littleEndian);
  }

  // 2 bytes at offset of 20 bytes
  set AudioFormat(uint) {
    this.view.setUint16(20, uint, this.littleEndian);
  }

  get AudioFormat() {
    return this.view.getUint16(20, this.littleEndian);
  }

  // 2 bytes at offset of 22 bytes
  set NumChannels(uint) {
    this.view.setUint16(22, uint, this.littleEndian);
  }

  get NumChannels() {
    return this.view.getUint16(22, this.littleEndian);
  }

  // 4 bytes at offset of 24 bytes
  set SampleRate(uint) {
    this.view.setUint32(24, uint, this.littleEndian);
  }

  get SampleRate() {
    return this.view.getUint32(24, this.littleEndian);
  }

  // 4 bytes at offset of 28 bytes
  set ByteRate(uint) {
    this.view.setUint32(28, uint, this.littleEndian);
  }

  get ByteRate() {
    return this.view.getUint32(28, this.littleEndian);
  }

  // 2 bytes at offset of 32 bytes
  set BlockAlign(uint) {
    this.view.setUint16(32, uint, this.littleEndian);
  }

  get BlockAlign() {
    return this.view.getUint16(32, this.littleEndian);
  }

  // 2 bytes at offset of 34 bytes
  set BitsPerSample(uint) {
    this.view.setUint16(34, uint, this.littleEndian);
  }

  get BitsPerSample() {
    return this.view.getUint16(34, this.littleEndian);
  }

  // 4 bytes at offset of 36 bytes
  set SubChunk2ID(str) {
    this.setString(str, 4, 36);
  }

  get SubChunk2ID() {
    return this.getString(4, 36);
  }

  // 4 bytes at offset of 40 bytes
  set SubChunk2Size(uint) {
    this.view.setUint32(40, uint, this.littleEndian);
  }

  get SubChunk2Size() {
    return this.view.getUint32(40, this.littleEndian);
  }

  // internal getter for sound data as
  // typed array based on header properties
  get typedData() {
    var bytesPerSample = this.BitsPerSample >>> 3;
    var data = this.data;
    var size = this.SubChunk2Size;
    var samples = size / bytesPerSample;
    var buffer = new ArrayBuffer(size);
    var uint8 = new Uint8Array(buffer);

    // convert signed normalized sound data to typed integer data
    // i.e. [-1, 1] -> [INT_MIN, INT_MAX]
    var amplitude = Math.pow(2, (bytesPerSample << 3) - 1) - 1;
    var i, d;

    switch (bytesPerSample) {
    case 1:
      // endianess not relevant for 8-bit encoding
      for (i = 0; i < samples; i++) {
        // convert by adding 0x80 instead of 0x100
        // WAV uses unsigned data for 8-bit encoding

        // [INT8_MIN, INT8_MAX] -> [0, UINT8_MAX]
        uint8[i] = (data[i] * amplitude + 0x80) & 0xFF;
      }
      break;
    case 2:
      // LSB first
      if (this.littleEndian) {
        for (i = 0; i < samples; i++) {
          // [INT16_MIN, INT16_MAX] -> [0, UINT16_MAX]
          d = (data[i] * amplitude + 0x10000) & 0xFFFF;

          // unwrap inner loop
          uint8[i * 2    ] = (d      ) & 0xFF;
          uint8[i * 2 + 1] = (d >>> 8);
        }
      // MSB first
      } else {
        for (i = 0; i < samples; i++) {
          // [INT16_MIN, INT16_MAX] -> [0, UINT16_MAX]
          d = (data[i] * amplitude + 0x10000) & 0xFFFF;

          // unwrap inner loop
          uint8[i * 2    ] = (d >>> 8);
          uint8[i * 2 + 1] = (d      ) & 0xFF;
        }
      }
      break;
    case 3:
      // LSB first
      if (this.littleEndian) {
        for (i = 0; i < samples; i++) {
          // [INT24_MIN, INT24_MAX] -> [0, UINT24_MAX]
          d = (data[i] * amplitude + 0x1000000) & 0xFFFFFF;

          // unwrap inner loop
          uint8[i * 3    ] = (d       ) & 0xFF;
          uint8[i * 3 + 1] = (d >>>  8) & 0xFF;
          uint8[i * 3 + 2] = (d >>> 16);
        }
      // MSB first
      } else {
        for (i = 0; i < samples; i++) {
          // [INT24_MIN, INT24_MAX] -> [0, UINT24_MAX]
          d = (data[i] * amplitude + 0x1000000) & 0xFFFFFF;

          // unwrap inner loop
          uint8[i * 3    ] = (d >>> 16);
          uint8[i * 3 + 1] = (d >>>  8) & 0xFF;
          uint8[i * 3 + 2] = (d       ) & 0xFF;
        }
      }
    case 4:
      // LSB first
      if (this.littleEndian) {
        for (i = 0; i < samples; i++) {
          // [INT32_MIN, INT32_MAX] -> [0, UINT32_MAX]
          d = (data[i] * amplitude + 0x100000000) & 0xFFFFFFFF;

          // unwrap inner loop
          uint8[i * 4    ] = (d       ) & 0xFF;
          uint8[i * 4 + 1] = (d >>>  8) & 0xFF;
          uint8[i * 4 + 2] = (d >>> 16) & 0xFF;
          uint8[i * 4 + 3] = (d >>> 24);
        }
      // MSB first
      } else {
        for (i = 0; i < samples; i++) {
          // [INT32_MIN, INT32_MAX] -> [0, UINT32_MAX]
          d = (data[i] * amplitude + 0x100000000) & 0xFFFFFFFF;

          // unwrap inner loop
          uint8[i * 4    ] = (d >>> 24);
          uint8[i * 4 + 1] = (d >>> 16) & 0xFF;
          uint8[i * 4 + 2] = (d >>>  8) & 0xFF;
          uint8[i * 4 + 3] = (d       ) & 0xFF;
        }
      }
    }

    return buffer;
  }

  // binary container outputs

  // browser-specific
  // generates blob from concatenated typed arrays
  toBlob() {
    return new Blob([this.header, this.typedData], {type: 'audio/wav'});
  }

  // Node.js-specific
  // generates buffer from concatenated typed arrays
  toBuffer() {
    return Buffer.concat([Buffer.from(this.header), Buffer.from(this.typedData)]);
  }

  // pointer mutators

  // gets time (in seconds) of pointer
  tell() {
    return this.pointer / this.NumChannels / this.SampleRate;
  }

  // sets time (in seconds) of pointer
  // zero-fills by default
  seek(time, fill = true) {
    var data   = this.data;
    var sample = Math.round(this.SampleRate * time);

    this.pointer = this.NumChannels * sample;

    if (fill) {
      // zero-fill seek
      while (data.length < this.pointer) {
        data[data.length] = 0;
      }
    } else {
      this.pointer = data.length;
    }
  }

  // sound data mutators

  // writes the specified note to the sound data
  // for amount of time in seconds
  // at given normalized amplitude
  // to channels listed (or all by default)
  // adds to existing data by default
  // and does not reset write index after operation by default
  writeNote({note, time, amplitude = 1}, channels = [], blend = true, reset = false) {
    // creating local references to properties
    var data = this.data;
    var numChannels = this.NumChannels;
    var sampleRate = this.SampleRate;

    // to prevent sound artifacts
    const fadeSeconds = 0.001;

    // calculating properties of given note
    var semitone = WAV.semitone(note);
    var frequency = WAV.frequency(semitone) * Math.PI * 2 / sampleRate;
    var period = Math.PI * 2 / frequency;

    // amount of blocks to be written
    var blocksOut = Math.round(sampleRate * time);
    // reduces sound artifacts by fading at last fadeSeconds
    var nonZero = blocksOut - sampleRate * fadeSeconds;
    // fade interval in samples
    var fade = blocksOut - nonZero + 1;

    // index of start and stop samples
    var start = this.pointer;
    var stop = data.length;

    // determines amount of blocks to be updated
    var blocksIn = Math.min(Math.floor((stop - start) / numChannels), blocksOut);

    // i = index of each sample block
    // j = index of each channel in a block
    // k = cached index of data
    // d = sample data value
    var i, j, k, d;

    // by default write to all channels
    if (channels.length === 0) {
      // don't overwrite passed array
      channels = [];

      for (i = 0; i < numChannels; i++) {
        channels[i] = i;
      }
    }

    // inline .indexOf() function calls into array references
    var skipChannel = [];

    for (i = 0; i < numChannels; i++) {
      skipChannel[i] = (channels.indexOf(i) === -1);
    }

    // update existing data
    for (i = 0; i < blocksIn; i++) {
      // iterate through specified channels
      for (j = 0; j < channels.length; j++) {
        k = start + i * numChannels + channels[j];
        d = 0;

        if (frequency > 0) {
          d = amplitude * Math.sin(frequency * i) * ((i < fade) ? i : (i > nonZero) ? blocksOut - i + 1 : fade) / fade;
        }

        data[k] = d + (blend ? data[k] : 0);
      }
    }

    // append data
    for (i = blocksIn; i < blocksOut; i++) {
      k = start + i * numChannels;

      // iterate through all channels
      for (j = 0; j < numChannels; j++) {
        d = 0;

        // only write non-zero data to specified channels
        if (frequency > 0 || !skipChannel[j]) {
          d = amplitude * Math.sin(frequency * i) * ((i < fade) ? i : (i > nonZero) ? blocksOut - i + 1 : fade) / fade;
        }

        data[k + j] = d;
      }
    }

    // update header properties
    var end = Math.max(start + blocksOut * numChannels, stop) * this.BitsPerSample >>> 3;

    this.ChunkSize = end + this.header.byteLength - 8;
    this.SubChunk2Size = end;

    if (!reset) {
      // move write index to end of written data
      this.pointer = start + blocksOut * numChannels;
    }
  }

  // adds specified notes in series
  // (or asynchronously if offset property is specified in a note)
  // each playing for time * relativeDuration seconds
  // followed by a time * (1 - relativeDuration) second rest
  writeProgression(notes, amplitude = 1, channels = [], blend = true, reset = false, relativeDuration = 1) {
    var start = this.pointer;

    for (var i = 0, note, time, amp, off, secs, rest; i < notes.length; i++) {
      ({note, time, amplitude: amp, offset: off} = notes[i]);

      // for asynchronous progression
      if (off !== undefined) {
        this.seek(off);
      }

      if (relativeDuration === 1 || note === 'REST') {
        this.writeNote({note, time, amplitude: amp === undefined ? amplitude : amp * amplitude}, channels, blend, false);
      } else {
        secs = time * relativeDuration;
        rest = time - secs;

        this.writeNote({note: note, time: secs, amplitude: amp === undefined ? amplitude : amp * amplitude}, channels, blend, false);
        this.writeNote({note: 'REST', time: rest}, channels, blend, false);
      }
    }

    if (reset) {
      this.pointer = start;
    }
  }
};

// utility class to calculate time from delta ticks
// when MIDI file has several `setTempo` events


function midiToWav(buffer, args = {}) {
  if (args.verbose) {
    console.log('parsing MIDI header...');
  }

  const midiStream = new MIDIStream(buffer);
  const header = midiStream.readChunk();
  console.log(header);

  if (header.id !== 'MThd' || header.length !== 6) {
    throw new SyntaxError('malformed header');
  }

  const headerStream = new MIDIStream(header.data);
  const formatType = headerStream.readUint16();
  const trackCount = headerStream.readUint16();
  const timeDivision = headerStream.readUint16();
  const tracks = [];
  const progression = [];
  const events = [];
  let maxAmplitude;

  for (let i = 0; i < trackCount; i++) {
    if (args.verbose) {
      console.log(`parsing track ${i + 1}...`);
    }

    const trackChunk = midiStream.readChunk();

    if (trackChunk.id !== 'MTrk') {
      continue;
    }

    const trackStream = new MIDIStream(trackChunk.data);
    const track = [];
    let keep = true;

    // determine whether applied filter will remove the current track while populating it
    while (keep && trackStream.byteOffset < trackChunk.length) {
      let event = trackStream.readEvent();
      track.push(event);

      if (typeof event.value === 'string') {
        if (args.verbose) {
          console.log(`{"${event.subType}":"${event.value}"}`);
        }

        if (Array.isArray(args.Skip)) {
          for (let t = 0; t < args.Skip.length; t++) {
            if (args.Skip[t][event.subType] === event.value) {
              if (args.verbose) {
                console.log(`skip match found: {"${event.subType}":"${event.value}"}`);
              }

              keep = false;
              break;
            }
          }
        }
      }
    }

    if (typeof args.Skip === 'function') {
      keep = !args.Skip(track);
    }

    if (keep) {
      tracks.push(track);
    } else if (args.verbose) {
      console.log(`skipping track ${i + 1}...`);
    }
  }

  if (timeDivision >>> 15 === 0) {
    // use microseconds per beat
    const timer = new Timer(timeDivision);

    if (args.verbose) {
      console.log('initializing timer...');
    }

    // set up timer with setTempo events
    for (let i = 0, delta = 0, ticks = 0, event; i < tracks[0].length; i++) {
      event = tracks[0][i];
      delta += event.delta;
      ticks += event.delta;

      if (event.subType === 'setTempo') {
        timer.addCriticalPoint(delta, event.value);
        delta = 0;
      }
    }

    // generate note data
    for (let i = 0; i < tracks.length; i++) {
      if (args.verbose) {
        console.log(`generating progression from track ${i + 1}...`);
      }

      let track = tracks[i];
      let delta = 0;
      let map = new Map();

      for (let j = 0; j < track.length; j++) {
        let event = track[j];
        delta += event.delta;

        if (event.type === 'channel') {
          const semitone = event.value.noteNumber;

          if (event.subType === 'noteOn') {
            let velocity = event.value.velocity;
            let offset = timer.getTime(delta);

            // use stack for simultaneous identical notes
            if (map.has(semitone)) {
              map.get(semitone).push({offset, velocity});
            } else {
              map.set(semitone, [{offset, velocity}]);
            }

            // to determine maximum total velocity for normalizing volume
            events.push({velocity, delta, note: true});
          } else if (event.subType === 'noteOff') {
            let note = map.get(semitone).pop();

            progression.push({
              note: WAV.note(semitone),
              time: timer.getTime(delta) - note.offset,
              amplitude: note.velocity / 128,
              offset: note.offset,
            });

            // to determine maximum total velocity for normalizing volume
            events.push({velocity: note.velocity, delta, note: false});
          }
        } else if (args.verbose && event.type === 'meta') {
          if (typeof event.value === 'string') {
            console.log(`${timer.getTime(delta).toFixed(2)}s ${event.subType}: ${event.value}`);
          }
        }
      }
    }

    if (args.verbose) {
      console.log('normalizing volume...');
    }

    events.sort(function (a, b) {
      return a.delta - b.delta || a.note - b.note;
    });

    if (args.verbose) {
      console.log('total notes:', progression.length);
      console.log('total time:', timer.getTime(events[events.length - 1].delta), 'seconds');
    }

    let maxVelocity = 1;
    let maxVelocityTime = 0;
    let velocity = 1;
    let maxChord = 0;
    let maxChordTime = 0;
    let chord = 0;

    for (const event of events) {
      if (event.note) {
        velocity += event.velocity;
        chord++;

        if (velocity > maxVelocity) {
          maxVelocity = velocity;
          maxVelocityTime = timer.getTime(event.delta);
        }

        if (chord > maxChord) {
          maxChord = chord;
          maxChordTime = timer.getTime(event.delta);
        }
      } else {
        velocity -= event.velocity;
        chord--;
      }
    }

    // scaling factor for amplitude
    maxAmplitude = 128 / maxVelocity;

    if (args.verbose) {
      console.log('setting volume to', maxAmplitude);
      console.log('  maximum chord of', maxChord, 'at', maxChordTime, 'seconds');
      console.log('  maximum velocity of', maxVelocity - 1, 'at', maxVelocityTime, 'seconds');
    }
  } else {
    // use frames per second
    // not yet implemented

    console.log('Detected unsupported MIDI timing mode');

    return null;

    /*
    let framesPerSecond = (division >>> 8) & 0x7F;
    let ticksPerFrame = division & 0xFF;

    if (framesPerSecond === 29) {
      framesPerSecond = 29.97;
    }

    // seconds per tick = 1 / frames per second / ticks per frame
    secsPerTick = 1 / framesPerSecond / ticksPerFrame;
    */
  }

  // set to mono
  args.channels = 1;

  if (args.verbose) {
    console.log('generating WAV buffer...');
  }

  const wav = new WAV(args.channels, args.sampleRate, args.bitsPerSample);

  wav.writeProgression(progression, maxAmplitude, [0], true, true, args.duration);

  return wav;
};