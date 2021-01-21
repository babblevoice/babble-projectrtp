

'use strict'

const net = require( "net" )
const events = require( "events" )
const sdptransform = require( "sdp-transform" )
const crypto = require( "crypto" )

/*
Some thoughts on this. We can have multiple rtp servers running and we need open channels on
an rtp server - but some calls maybe better handled by a specific server than another. For example,
If sip:1000@bling.babblevoice.com has a call already on a specific server, then a second call handled
by that user should be sent to the same server as they are likely to be bridged - which is best done on
the same server - otherwise we have to do all of the logic to send rtp between 2 different rtp servers.
*/


/*
  An SDP Generator.
*/
var sessionidcounter = Math.floor( Math.random() * 100000 )

const codecconv = { "0": "pcmu", "8": "pcma", "9": "g722", "97": "ilbc", "101": "2833" }
const codecrconv = { "pcmu": 0, "pcma": 8, "g722": 9, "ilbc": 97, "2833": 101 }

const codecdefs = {
  "type": {
    "pcmu": "audio",
    "pcma": "audio",
    "g722": "audio",
    "ilbc": "audio",
    "2833": "audio",
  },
  "rtp": {
    "pcmu": { payload: 0, codec: 'PCMU', rate: 8000 },
    "pcma": { payload: 8, codec: 'PCMA', rate: 8000 },
    "g722": { payload: 9, codec: 'G722', rate: 16000 },
    "ilbc": { payload: 97, codec: 'ilbc', rate: 8000 },
    "2833": { payload: 101, codec: 'telephone-event' }
  },
  "fmtp": {
    "ilbc": { payload: 97, config: "mode=20" },
    "2833": { payload: 101, config: "0-16" } /* 0-16 = DTMF */
  }
}

const defaultaudiomedia = {
                      "rtp": [],
                      "fmtp": [],
                      "type": "audio",
                      "port": 0,
                      "protocol": "RTP/AVP",
                      "payloads": [],
                      "ptime": 20,
                      "direction": "sendrecv"
                    }

class sdpgen {

  constructor( sdp ) {

    if( undefined === sdp ) {
      sessionidcounter = ( sessionidcounter + 1 ) % 4294967296

      this.sdp = {
        version: 0,
        origin: {
          username: '-',
          sessionId: sessionidcounter,
          sessionVersion: 0,
          netType: 'IN',
          ipVer: 4,
          address: "127.0.0.1"
        },
        name: 'project',
        timing: { start: 0, stop: 0 },
        connection: { version: 4, ip: "127.0.0.1" },
        //iceUfrag: 'F7gI',
        //icePwd: 'x9cml/YzichV2+XlhiMu8g',
        //fingerprint:
        // { type: 'sha-1',
        //   hash: '42:89:c5:c6:55:9d:6e:c8:e8:83:55:2a:39:f9:b6:eb:e9:a3:a9:e7' },
        media: [ {
          rtp: [],
          fmtp: [],
          type: "audio",
          port: 0,
          protocol: "RTP/AVP",
          payloads: [],
          ptime: 20,
          direction: "sendrecv"
        } ]
      }
    } else {

      this.sdp = sdptransform.parse( sdp )

      /* Convert payloads to something more consistent. Always an array of Numbers */
      this.sdp.media.forEach( ( media, i, a ) => {

        if( "audio" === media.type ) {
          if( typeof media.payloads === "string" ) {
            media.payloads = media.payloads.split(  /[ ,]+/  )
          }

          if( !Array.isArray( media.payloads ) ) {
            a[ i ].payloads = [ media.payloads ]
          }

          media.payloads.forEach( ( v, vi, va ) => va[ vi ] = Number( v ) )
        }
      } )
    }
  }

  /*
  Used by our rtpchannel to get the port and address information (and codec).
  */
  getaudioremote() {
    let m = this.sdp.media.find( mo => "audio" === mo.type )

    if( m ) {

      let payloads = m.payloads
      if( this.selected !== undefined ) {
        payloads = [ this.selected ]
      }

      return {
        "port": m.port,
        "ip": this.sdp.connection.ip,
        "audio": { "payloads": payloads }
      }
    }
    return false
  }

  /*
  select works in conjunction with getaudioremote and allows us to force the
  selection of the codec we send to our RTP server. This is used on the offered SDP.
  If intersect has been called with firstonly flag set then this has the same effect.
  */
  select( codec ) {
    if( isNaN( codec ) ) {
      if( undefined === codecrconv[ codec ] ) return
      codec = codecrconv[ codec ]
    }
    this.selected = Number( codec )

    return this
  }

  static create( sdp ) {
    return new sdpgen( sdp )
  }

  setsessionid( i ) {
    this.sdp.origin.sessionId = i
    return this
  }

  setconnectionaddress( addr ) {
    this.sdp.connection.ip = addr
    return this
  }

  setoriginaddress( addr ) {
    this.sdp.origin.address = addr
    return this
  }

  setaudioport( port ) {
    this.getmedia().port = port
    return this
  }

  setchannel( ch ) {
    this.setaudioport( ch.local.port )
        .setconnectionaddress( ch.local.ip )
        .setoriginaddress( ch.local.ip )
    return this
  }

  getmedia( type = "audio" ) {
    let m = this.sdp.media.find( mo => type === mo.type )
    if( !m ) {
      this.sdp.media.push( defaultaudiomedia )
      m = this.sdp.media[ this.sdp.media.length - 1 ]
    }

    return m
  }

  /*
  Add a CODEC or CODECs, formats:
  "pcma"
  "pcma pcmu"
  "pcma, pcmu"
  [ "pcma", pcmu ]
  */
  addcodecs( codecs ) {
    let codecarr = codecs
    if( !Array.isArray( codecarr ) ) {
      codecarr = codecs.split( /[ ,]+/ )
    }

    codecarr.forEach( codec => {

      /* Don't allow duplicates */
      let codecn = codecrconv[ codec ]
      if( this.sdp.media.find( m => m.payloads.find( v => codecn == v ) ) ) return

      if( undefined !== codecdefs.rtp[ codec ] ) {
        /* suported audio */
        let m = this.getmedia( codecdefs.type[ codec ] )

        m.rtp.push( codecdefs.rtp[ codec ] )
        m.payloads.push( codecdefs.rtp[ codec ].payload )

        if( undefined !== codecdefs.fmtp[ codec ] ) {
          m.fmtp.push( codecdefs.fmtp[ codec ] )
        }
      }
    } )

    return this
  }

  /*
  Only allow CODECs supported by both sides.
  other can be:
  "pcma pcmu ..."
  "pcma,pcmu"
  "0,8"
  "0 8"
  [ "pcma", "pcmu" ]
  [ 0, 8 ]

  Returns a codec string
  "pcma pcmu"

  If first ony, it only returns the first match
  */
  intersection( other, firstonly = false ) {
    if( typeof other === "string" ){
      other = other.split( /[ ,]+/ )
    }

    /* convert to payloads */
    other.forEach( ( codec, i, a ) => {
      if( isNaN( codec ) ) {
        a[ i ] = codecrconv[ codec ]
      }
    } )

    /* Does it exist in payloads and fmtp where required */
    let retval = []
    this.sdp.media.forEach( m => {
      retval = retval.concat( other.filter( pl => {
        if( m.payloads.includes( pl ) ) {
          let codecname = codecconv[ pl ]
          if( undefined === codecdefs.fmtp[ codecname ] ) return true

          let fmtp = codecdefs.fmtp[ codecname ] /* i.e. { payload: 97, config: "mode=20" } */
          if( undefined !== m.fmtp.find( f => f.payload == fmtp.payload && f.config == fmtp.config ) ) return true
        }
        return false
      } ) )
    } )

    if( firstonly && retval.length > 0 ) {
      retval = [ retval[ 0 ] ]
      this.select( retval[ 0 ] )
    }

    /* We want named codecs */
    retval.forEach( ( codec, i, a ) => {
      if( undefined != codecconv[ codec ] ) a[ i ] = codecconv[ codec ]
    } )

    return retval.join( " " )
  }

  toString() {

    /* We need to convert payloads back to string to stop a , being added */
    let co = Object.assign( this.sdp )

    co.media.forEach( ( media, i, a ) => {
      a[ i ].payloads = media.payloads.join( " " )
    } )

    return sdptransform.write( co ).trim()
  }
}

/*
  An RTP Channel
*/
class projectrtpchannel {
  constructor( prtp, sdp ) {
    this.conn = prtp
    this.remotesdp = sdp
    this.id = crypto.randomBytes( 16 ).toString( "hex" )
    this.conn.channels.set( this.id, this )
    this.uuid = false

    this.state = 0

    this.em = new events.EventEmitter()

    this.openresolve = false
    this.openreject = false
    this.closeresolve = false
    this.closereject = false
  }

  open() {
    this.state = 1

    return new Promise( ( resolve, reject ) => {
      let msg = {
        "channel": "open",
        "id": this.id
      }

      if( undefined !== this.remotesdp ) {
        msg.target = this.remotesdp.getaudioremote()
      }

      this.openresolve = resolve
      this.openreject = reject
      this.conn.send( msg )
    } )
  }

  target( sdp ) {

    this.remotesdp = sdp
    let msg = {
      "channel": "target",
      "uuid": this.uuid,
      "target": this.remotesdp.getaudioremote()
    }

    this.conn.send( msg )
  }

  rfc2833( pt ) {
    let msg = {
      "channel": "rfc2833",
      "uuid": this.uuid,
      "pt": pt
    }

    this.conn.send( msg )
  }

  mix( other ) {

    let msg = {
      "channel": "mix",
      "uuid": [ this.uuid, other.uuid ]
    }

    this.conn.send( msg )
  }

  unmix() {

    let msg = {
      "channel": "unmix",
      "uuid": this.uuid
    }

    this.conn.send( msg )
  }

  play( soup ) {

    let msg = {
      "channel": "play",
      "uuid": this.uuid,
      "soup": soup
    }

    this.conn.send( msg )
  }

  echo() {

    let msg = {
      "channel": "echo",
      "uuid": this.uuid
    }

    this.conn.send( msg )
  }

  on( event, cb ) {
    this.em.on( event, cb )
  }

  update( msg ) {
    switch( msg.action ) {

      case "open": {
        if( false === this.uuid &&
            undefined !== msg.channel.uuid ) {
          this.local = {}
          this.local.ip = msg.channel.ip
          this.local.port = msg.channel.port
          this.uuid = msg.channel.uuid

          if( false !== this.openresolve ) this.openresolve( this )

        }
        break
      }

      case "telephone-event": {
        this.em.emit( "telephone-event", msg.event )
        break
      }

      case "close": {
        if( false !== this.closeresolve ) this.closeresolve( this )

        this.conn.channels.delete( this.id )
        break
      }
    }
  }

  /* Add a timer? */
  destroy()
  {
    return new Promise( ( resolve, reject ) => {
      let msg = {
        "channel": "close",
        "uuid": this.uuid
      }

      this.closeresolve = resolve
      this.closereject = reject
      this.conn.send( msg )
    } )
  }
}

class ProjectRTP {
  constructor( options ) {

    this.options = {
      "port": 9002,
      "address": "127.0.0.1"
    }

    this.connections = new Map()
    this.channels = new Map()

    this.options = { ...this.options, ...options }
    this.server = net.createServer()
    this.em = new events.EventEmitter()

    this.server.listen( this.options.port, this.options.address, () => {
      console.log( `ProjectRTP control server listening on port ${this.options.port}` )
    } )

    this.server.on( "connection", ( sock ) => {
      console.log( "Client connected" )

      var key = sock.remoteAddress.replace( /\./g, "_" ) + "_" + sock.remotePort
      var srv = { "sock": sock, "key": key, "projectrtp": this }
      sock.parent = srv
      this.connections.set( key, srv )
      this.em.emit( "connection", srv )

      sock.on( "close", function(){
        this.parent.projectrtp.connections.delete( this.parent.key )
        this.parent.projectrtp.em.emit( "close", { "sock": sock } )
      } )

      var state = 0 /* waiting on header */
      var bodylength = 0
      var bodylengthread = 0
      var bodycache = new Buffer.from([])

      sock.on( "data", ( data ) => {

        if( 2 == state ) {
          state = 0
          return
        }

        bodycache = Buffer.concat( [ bodycache, data ] )

        while( bodycache.length > 0 ) {
          if( 0 === state ) {
            let dataheader = bodycache.slice( 0, 5 )
            bodycache = bodycache.slice( 5 )

            if( 0x33 == dataheader[ 0 ] ) {
              bodylength = ( dataheader[ 3 ] << 8 ) | dataheader[ 4 ]
              // We should do more checks here
              state = 1
            } else {
              console.error( "ProjectRTP Bad Magic" )
              state = 2
              return
            }
          }

          if( bodycache.length > 0 ) {

            if( bodycache.length < bodylength ) {
              return
            } else {
              state = 0
              let msgbody = bodycache.slice( 0, bodylength ).toString()
              // so that we simpy just don't index the old full buffer which grows and grows
              bodycache = new Buffer.from( bodycache.slice( bodylength ) )

              let msg = JSON.parse( msgbody )

              let chann = this.channels.get( msg.id )
              if( undefined !== chann ) {
                chann.update( msg )
              }
            }
          }
        }
      } )
    } )

    this.server.on( "close", ( ) => {
      console.log( "Shutting down control server" )
    } )
  }

  on( event, cb ) {
    this.em.on( event, cb )
  }

  send( msg ) {
    /* more decision logic required */
    const iterator1 = this.connections.keys()
    const key = iterator1.next().value
    let sock = this.connections.get( key ).sock

    let encoded = JSON.stringify( msg )
    sock.write( Buffer.from( [ 0x33, 0x00, 0x00, ( encoded.length >> 8 ) & 0xff, encoded.length & 0xff ] ) )
    sock.write( encoded )
  }

  /*
    open a channel and get the port number to publish
    sdp is our received sdp as object - to obtain our target
  */
  channel( sdp ) {
    let channel = new projectrtpchannel( this, sdp )
    return channel.open()
  }

  close() {
    this.server.close()

    this.connections.forEach( ( conn, key, map ) => {
      conn.sock.destroy()
    } )
  }
};

module.exports.ProjectRTP = ProjectRTP
module.exports.sdp = sdpgen
