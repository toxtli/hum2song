! function(e) {
    function n() {
        var e, n, t, r = navigator.userAgent,
            o = navigator.appName,
            a = "" + parseFloat(navigator.appVersion),
            i = parseInt(navigator.appVersion, 10);
        (n = r.indexOf("Opera")) != -1 ? (o = "Opera", a = r.substring(n + 6), (n = r.indexOf("Version")) != -1 && (a = r.substring(n + 8))) : (n = r.indexOf("MSIE")) != -1 ? (o = "Microsoft Internet Explorer", a = r.substring(n + 5)) : (n = r.indexOf("Trident")) != -1 ? (o = "Microsoft Internet Explorer", a = (n = r.indexOf("rv:")) != -1 ? r.substring(n + 3) : "0.0") : (n = r.indexOf("Chrome")) != -1 ? (o = "Chrome", a = r.substring(n + 7)) : (n = r.indexOf("Android")) != -1 ? (o = "Android", a = r.substring(n + 8)) : (n = r.indexOf("Safari")) != -1 ? (o = "Safari", a = r.substring(n + 7), (n = r.indexOf("Version")) != -1 && (a = r.substring(n + 8))) : (n = r.indexOf("Firefox")) != -1 ? (o = "Firefox", a = r.substring(n + 8)) : (e = r.lastIndexOf(" ") + 1) < (n = r.lastIndexOf("/")) && (o = r.substring(e, n), a = r.substring(n + 1), o.toLowerCase() == o.toUpperCase() && (o = navigator.appName)), (t = a.indexOf(";")) != -1 && (a = a.substring(0, t)), (t = a.indexOf(" ")) != -1 && (a = a.substring(0, t)), i = parseInt("" + a, 10), isNaN(i) && (a = "" + parseFloat(navigator.appVersion), i = parseInt(navigator.appVersion, 10));
        var s = new Object;
        return s.browserName = o, s.fullVersion = a, s.majorVersion = i, s.appName = navigator.appName, s.userAgent = navigator.userAgent, s.platform = navigator.platform, s
    }

    function t(e, n) {
        var t = document.getElementsByTagName("script")[0],
            r = document.createElement("script");
        r.onreadystatechange = function() {
            "loaded" !== r.readyState && "complete" !== r.readyState || (r.onreadystatechange = null, n())
        }, r.onload = function() {
            n()
        }, r.onerror = function() {
            j("Error: Cannot load  JavaScript file " + e)
        }, r.src = e, r.type = "text/javascript", t.parentNode.insertBefore(r, t)
    }

    function r(e) {
        if (V = Module.ccall("mid_song_read_wave", "number", ["number", "number", "number", "number"], [R, w, 2 * B, q]), 0 == V) return void b();
        for (var n = Math.pow(2, 15), t = 0; t < B; t++) t < V ? e.outputBuffer.getChannelData(0)[t] = Module.getValue(w + 2 * t, "i16") / n : e.outputBuffer.getChannelData(0)[t] = 0;
        0 == H && (H = T.currentTime)
    }

    function o(e, n, t) {
        var o = new XMLHttpRequest;
        o.open("GET", n + t, !0), o.responseType = "arraybuffer", o.onerror = function() {
            j("Error: Cannot retrieve patch file " + n + t)
        }, o.onload = function() {
            if (200 != o.status) return void j("Error: Cannot retrieve patch file " + n + t + " : " + o.status);
            if (L--, FS.createDataFile("pat/", t, new Int8Array(o.response), !0, !0), MIDIjs.message_callback && L > 0 && MIDIjs.message_callback("Instruments to be loaded: " + L), j("Instruments to be loaded: " + L), 0 == L) {
                var a = Module.ccall("mid_istream_open_mem", "number", ["number", "number", "number"], [O, A.length, !1]),
                    i = 32784,
                    u = Module.ccall("mid_create_options", "number", ["number", "number", "number", "number"], [T.sampleRate, i, 1, 2 * B]);
                R = Module.ccall("mid_song_load", "number", ["number", "number"], [a, u]);
                Module.ccall("mid_istream_close", "number", ["number"], [a]);
                Module.ccall("mid_song_start", "void", ["number"], [R]), k = T.createScriptProcessor(B, 0, 1), w = Module._malloc(2 * B), k.onaudioprocess = r, k.connect(T.destination), P = setInterval(s, G), MIDIjs.message_callback && MIDIjs.message_callback("Playing: " + e), j("Playing: " + e + " ...")
            }
        }, o.send()
    }

    function a(e) {
        var n = new XMLHttpRequest;
        n.open("GET", e, !0), n.responseType = "arraybuffer", n.onerror = function() {
            j("Error: Cannot preload file " + e)
        }, n.onload = function() {
            if (200 != n.status) return void j("Error: Cannot preload file " + e + " : " + n.status)
        }, n.send()
    }

    function i() {
        for (var e = T.createBuffer(1, 44100, 44100), n = 0; n < 48e3; n++) e.getChannelData(0)[n] = 0;
        var t = T.createBufferSource();
        t.buffer = e, t.connect(T.destination), t.start(0)
    }

    function s() {
        var e = new Object;
        0 != H ? e.time = T.currentTime - H : e.time = 0, MIDIjs.player_callback && MIDIjs.player_callback(e)
    }

    function u(e) {
        p(), q = !1, B = S, l(e)
    }

    function l(e) {
        H = 0, s(), "iPad" != navigator.platform && "iPhone" != navigator.platform && "iPod" != navigator.platform || i();
        for (var n = 0; n < document.scripts.length; n++) {
            var r = document.scripts[n].src;
            if (C == r) return void c(e)
        }
        j("Loading libtimidity ... "), t(C, function() {
            c(e)
        })
    }

    function c(e) {
        if (-1 != e.indexOf("data:")) {
            var n = e.indexOf(",") + 1,
                t = atob(e.substring(n));
            A = new Uint8Array(new ArrayBuffer(t.length));
            for (var r = 0; r < t.length; r++) A[r] = t.charCodeAt(r);
            return void d("data:audio/x-midi ...", A)
        }
        j("Loading MIDI file " + e + " ..."), MIDIjs.message_callback("Loading MIDI file " + e + " ...");
        var o = new XMLHttpRequest;
        o.open("GET", e, !0), o.responseType = "arraybuffer", o.onerror = function() {
            j("Error: Cannot retrieve MIDI file " + e)
        }, o.onload = function() {
            return 200 != o.status ? void j("Error: Cannot retrieve MIDI file " + e + " : " + o.status) : (j("MIDI file loaded: " + e), A = new Int8Array(o.response), void d(e, A))
        }, o.send()
    }

    function d(e, n) {
        O = Module._malloc(n.length), Module.writeArrayToMemory(n, O);
        var t = Module.ccall("mid_init", "number", [], []),
            a = Module.ccall("mid_istream_open_mem", "number", ["number", "number", "number"], [O, n.length, !1]),
            i = 32784,
            u = Module.ccall("mid_create_options", "number", ["number", "number", "number", "number"], [T.sampleRate, i, 1, 2 * B]);
        if (R = Module.ccall("mid_song_load", "number", ["number", "number"], [a, u]), t = Module.ccall("mid_istream_close", "number", ["number"], [a]), L = Module.ccall("mid_song_get_num_missing_instruments", "number", ["number"], [R]), 0 < L)
            for (var l = 0; l < L; l++) {
                var c = Module.ccall("mid_song_get_missing_instrument", "string", ["number", "number"], [R, l]);
                o(e, F + "pat/", c)
            } else Module.ccall("mid_song_start", "void", ["number"], [R]), k = T.createScriptProcessor(B, 0, 1), w = Module._malloc(2 * B), k.onaudioprocess = r, k.connect(T.destination), P = setInterval(s, G), MIDIjs.message_callback && MIDIjs.message_callback("Playing: " + e), j("Playing: " + e + " ...")
    }

    function m(e, n, t) {
        q || (q = !0, B = N, l(F + "../midi/initsynth.midi")), 0 != R && Module.ccall("mid_song_note_on", "void", ["number", "number", "number", "number"], [R, e, n, t])
    }

    function f() {
        MIDIjs.noteOn(0, 60, 0)
    }

    function b() {
        k && (k.disconnect(), k.onaudioprocess = 0, k = 0), R && (Module._free(w), Module._free(O), Module.ccall("mid_song_free", "void", ["number"], [R]), Module.ccall("mid_exit", "void", [], []), R = 0)
    }

    function p() {
        b(), clearInterval(P), j(W)
    }

    function I(e) {
        return "undefined" == typeof E && (E = document.createElement("a")), E.href = e, E.href
    }

    function g(e) {
        if (e.indexOf("http:") != -1) return e;
        var n = I(e),
            t = n.replace("https:", "http:");
        return t
    }

    function M() {
        var e = new Object;
        0 == H && (H = (new Date).getTime()), e.time = ((new Date).getTime() - H) / 1e3, MIDIjs.player_callback && MIDIjs.player_callback(e)
    }

    function v(e) {
        _(), url = g(e);
        var n = document.getElementById("scorioMIDI");
        n ? n.lastChild.setAttribute("src", url) : (n = document.createElement("div"), n.setAttribute("id", "scorioMIDI"), n.innerHTML = '&nbsp;<bgsound src="' + url + '" volume="0"/>', document.body && document.body.appendChild(n)), P = setInterval(M, G), H = 0, k = n, j("Playing " + url + " ...")
    }

    function _() {
        if (k) {
            var e = k;
            e.lastChild.setAttribute("src", g(F) + "silence.mid"), clearInterval(P), k = 0
        }
        j(W)
    }

    function y(e) {
        D();
        var n = document.getElementById("scorioMIDI");
        n ? n.lastChild.setAttribute("data", e) : (n = document.createElement("div"), n.setAttribute("id", "scorioMIDI"), n.innerHTML = '<object data="' + e + '" autostart="true" volume="0" type="audio/mid"></object>', document.body && document.body.appendChild(n)), P = setInterval(M, G), H = 0, k = n, j("Playing " + e + " ...")
    }

    function D() {
        if (k) {
            var e = k;
            e.parentNode.removeChild(e), clearInterval(P), k = 0
        }
        j(W)
    }

    function h() {
        for (var e = 0; e < document.scripts.length; e++) {
            var n = document.scripts[e].src,
                t = n.lastIndexOf("midi.js");
            if (t == n.length - 7) return n.substr(0, t)
        }
        return null
    }

    function j(e) {
        z && console.log(e)
    }
    try {
        e.MIDIjs = new Object, e.MIDIjs.initError = "initializing ...";
        var x, w, O, A, C, E, P, T = 0,
            k = 0,
            N = 512,
            S = 8192,
            B = S,
            L = 0,
            V = 0,
            R = 0,
            F = "",
            H = 0,
            W = "",
            q = !1,
            z = !1,
            G = 100;
        F = h(), C = F + "libtimidity.js";
        var X = n();
        try {
            ("iPhone" == X.platform || "iPod" == X.platform || "iPad" == X.platform) && X.majorVersion <= 6 ? x = "none" : (window.AudioContext = window.AudioContext || window.webkitAudioContext, T = new AudioContext, x = "WebAudioAPI")
        } catch (U) {
            x = "Microsoft Internet Explorer" == X.browserName ? "bgsound" : "Android" == X.browserName ? "none" : "object"
        }
        e.MIDIjs.set_logging = function(e) {
            z = e
        }, e.MIDIjs.get_loggging = function() {
            return z
        }, e.MIDIjs.player_callback = function(e) {}, e.MIDIjs.message_callback = function(e) {}, e.MIDIjs.get_audio_status = function() {
            return W
        }, e.MIDIjs.unmute_iOS_hack = i, "WebAudioAPI" == x ? (t(C, function() {}), e.MIDIjs.play = u, e.MIDIjs.stop = p, W = "audioMethod: WebAudioAPI, sampleRate (Hz): " + T.sampleRate + ", audioBufferSize (Byte): " + B, e.MIDIjs.noteOn = m, e.MIDIjs.startSynth = f) : "bgsound" == x ? (e.MIDIjs.play = v, e.MIDIjs.stop = _, W = "audioMethod: &lt;bgsound&gt;") : "object" == x ? (e.MIDIjs.play = y, e.MIDIjs.stop = D, W = "audioMethod: &lt;object&gt;") : (e.MIDIjs.play = function(e) {}, e.MIDIjs.stop = function(e) {}, W = "audioMethod: No method found"), "Microsoft Internet Explorer" == X.browserName && "https:" == location.protocol.toLowerCase() && setTimeout(function() {
            v(g(F) + "silence.mid"), clearInterval(P)
        }, 1), -1 == location.href.indexOf("scorio.com") && -1 == location.href.indexOf("weblily.net") && -1 == location.href.indexOf("local") || "WebAudioAPI" == x && (a(F + "pat/arachno-127.pat"), a(F + "pat/MT32Drums/mt32drum-41.pat"), a(C)), e.MIDIjs.initError = null
    } catch (J) {
        e.MIDIjs = new Object, e.MIDIjs.initError = J
    }
}(this);
//# sourceMappingURL=/lib/midi.js.map