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

const requesttimeout = 1500


/*
  An SDP Generator.
*/
var sessionidcounter = Math.floor( Math.random() * 100000 )

const codecconv = {
  "0": "pcmu",
  "8": "pcma",
  "9": "g722",
  "97": "ilbc",
  "101": "2833"
}
const codecrconv = {
  "pcmu": 0,
  "pcma": 8,
  "g722": 9,
  "ilbc": 97,
  "2833": 101
}

const codecdefs = {
  "type": {
    "pcmu": "audio",
    "pcma": "audio",
    "g722": "audio",
    "ilbc": "audio",
    "2833": "audio",
  },
  "rtp": {
    "pcmu": {
      payload: 0,
      codec: 'PCMU',
      rate: 8000
    },
    "pcma": {
      payload: 8,
      codec: 'PCMA',
      rate: 8000
    },
    "g722": {
      payload: 9,
      codec: 'G722',
      rate: 16000
    },
    "ilbc": {
      payload: 97,
      codec: 'ilbc',
      rate: 8000
    },
    "2833": {
      payload: 101,
      codec: 'telephone-event'
    }
  },
  "fmtp": {
    "ilbc": {
      payload: 97,
      config: "mode=20"
    },
    "2833": {
      payload: 101,
      config: "0-16"
    } /* 0-16 = DTMF */
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

    if ( undefined === sdp ) {
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
        timing: {
          start: 0,
          stop: 0
        },
        connection: {
          version: 4,
          ip: "127.0.0.1"
        },
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

        if ( "audio" === media.type ) {
          if ( typeof media.payloads === "string" ) {
            media.payloads = media.payloads.split( /[ ,]+/ )
          }

          if ( !Array.isArray( media.payloads ) ) {
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

    if ( m ) {

      let payloads = m.payloads
      if ( this.selected !== undefined ) {
        payloads = [ this.selected ]
      }

      return {
        "port": m.port,
        "ip": this.sdp.connection.ip,
        "audio": {
          "payloads": payloads
        }
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
    if ( isNaN( codec ) ) {
      if ( undefined === codecrconv[ codec ] ) return
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
    if ( !m ) {
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
    if ( !Array.isArray( codecarr ) ) {
      codecarr = codecs.split( /[ ,]+/ )
    }

    codecarr.forEach( codec => {

      /* Don't allow duplicates */
      let codecn = codecrconv[ codec ]
      if ( this.sdp.media.find( m => m.payloads.find( v => codecn == v ) ) ) return

      if ( undefined !== codecdefs.rtp[ codec ] ) {
        /* suported audio */
        let m = this.getmedia( codecdefs.type[ codec ] )

        m.rtp.push( codecdefs.rtp[ codec ] )
        m.payloads.push( codecdefs.rtp[ codec ].payload )

        if ( undefined !== codecdefs.fmtp[ codec ] ) {
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
    if ( typeof other === "string" ) {
      other = other.split( /[ ,]+/ )
    }

    /* convert to payloads */
    other.forEach( ( codec, i, a ) => {
      if ( isNaN( codec ) ) {
        a[ i ] = codecrconv[ codec ]
      }
    } )

    /* Does it exist in payloads and fmtp where required */
    let retval = []
    this.sdp.media.forEach( m => {
      retval = retval.concat( other.filter( pl => {
        if ( m.payloads.includes( pl ) ) {
          let codecname = codecconv[ pl ]
          if ( undefined === codecdefs.fmtp[ codecname ] ) return true

          let fmtp = codecdefs.fmtp[ codecname ] /* i.e. { payload: 97, config: "mode=20" } */
          if ( undefined !== m.fmtp.find( f => f.payload == fmtp.payload && f.config == fmtp.config ) ) return true
        }
        return false
      } ) )
    } )

    if ( firstonly && retval.length > 0 ) {
      retval = [ retval[ 0 ] ]
      this.select( retval[ 0 ] )
    }

    /* We want named codecs */
    retval.forEach( ( codec, i, a ) => {
      if ( undefined != codecconv[ codec ] ) a[ i ] = codecconv[ codec ]
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
  constructor( prtp, sdp, srv ) {
    this.conn = prtp
    this.remotesdp = sdp
    this.srv = srv
    this.id = crypto.randomBytes( 16 ).toString( "hex" )
    this.conn.channels.set( this.id, this )
    this.uuid = false

    this.state = 0

    this.em = new events.EventEmitter()

    this.openresolve = false
    this.openreject = false
    this.opentimer = false
    this.closeresolve = false
    this.closereject = false
    this.closetimer = false
  }

  open() {
    this.state = 1

    return new Promise( ( resolve, reject ) => {
      let msg = {
        "channel": "open",
        "id": this.id
      }

      if ( undefined !== this.remotesdp ) {
        msg.target = this.remotesdp.getaudioremote()
      }

      this.openresolve = resolve
      this.openreject = reject

      this.opentimer = setTimeout( () => {
        if ( false !== this.opentimer ) {
          this.openreject()
        }
        this.openreject = false
        this.opentimer = false
      }, requesttimeout )

      this.send( msg )
    } )
  }

  target( sdp ) {

    this.remotesdp = sdp
    let msg = {
      "channel": "target",
      "uuid": this.uuid,
      "target": this.remotesdp.getaudioremote()
    }

    this.send( msg )
  }

  rfc2833( pt ) {
    let msg = {
      "channel": "rfc2833",
      "uuid": this.uuid,
      "pt": pt
    }

    this.send( msg )
  }

  mix( other ) {

    let msg = {
      "channel": "mix",
      "uuid": [ this.uuid, other.uuid ]
    }

    this.send( msg )
  }

  unmix() {

    let msg = {
      "channel": "unmix",
      "uuid": this.uuid
    }

    this.send( msg )
  }

  play( soup ) {

    let msg = {
      "channel": "play",
      "uuid": this.uuid,
      "soup": soup
    }

    this.send( msg )
  }

  send( msg ) {
    this.conn.send( this.srv, msg )
  }

  echo() {

    let msg = {
      "channel": "echo",
      "uuid": this.uuid
    }

    this.send( msg )
  }

  on( event, cb ) {
    this.em.on( event, cb )
  }

  /* is currently opened */
  get isopen() {
    return this.state >= 2
  }

  /* has it been/is it closed */
  get isclosed() {
    return this.state === 3
  }

  update( msg ) {
    switch ( msg.action ) {

      case "open": {
        this.state = 2
        if ( false === this.uuid &&
          undefined !== msg.channel.uuid ) {
          this.local = {}
          this.local.ip = msg.channel.ip
          this.local.port = msg.channel.port
          this.uuid = msg.channel.uuid

          this.em.emit( "open", msg )
          if ( false !== this.openresolve ) this.openresolve( this )

        }
        break
      }

      case "telephone-event": {
        this.em.emit( "telephone-event", msg.event )
        break
      }

      case "close": {
        this.em.emit( "close", msg )
        if ( false !== this.closetimer ) clearTimeout( this.closetimer )
        if ( false !== this.closeresolve ) this.closeresolve( this )
        this.conn.channels.delete( this.id )
        this.state = 3
        break
      }
    }
  }

  destroy() {
    return new Promise( ( resolve, reject ) => {
      let msg = {
        "channel": "close",
        "uuid": this.uuid
      }

      /* Already closed */
      if ( 3 === this.state ) {
        this.closereject( this )
        return
      }

      this.closeresolve = resolve
      this.closereject = reject

      this.closetimer = setTimeout( () => {
        if ( false !== this.closereject ) {
          this.closereject()
        }
        this.closereject = false
        this.closetimer = false
      }, requesttimeout )

      this.send( msg )
    } )
  }
}

/*
  class ProjectRTP

  Listens for connections from projectrtp instances and farms out work to them.

  Data we track:
  {
    Connection - a tcp control connection to a projectrtp server
    Channel - an RTP channel between our rtpengine instance and the client
    connections: Map < key - protjectrtp instance id > { {
        sock - the underlying socket
        instance - the instance (uuid) which we where provided
        projectrtp - reference back to the main projectrtp singleton
        active - number of channels currently active
        available - number of channels currently available
      }
    }
    channels: Map < key - our channel instance id >

    Total across all connected instances:
    stats: {
      available
      active
    }
  }
*/

class ProjectRTP {
  constructor( options ) {

    this.options = {
      "port": 9002,
      "address": "127.0.0.1",
      "debug": false
    }

    this.connections = new Map()
    this.channels = new Map()

    /* Totals across all clients */
    this.stats = {}
    this.stats.available = 0
    this.stats.active = 0

    this.options = {
      ...this.options,
      ...options
    }
    this.server = net.createServer()
    this.em = new events.EventEmitter()

    this.server.listen( this.options.port, this.options.address, () => {
      this.consolelog( `ProjectRTP control server listening on port ${this.options.port}` )
    } )

    this.server.on( "connection", ( sock ) => {
      sock.on( "close", () => {
        let old = this.connections.get( sock.parent.instance )
        if ( undefined !== old ) {
          this.stats.available -= old.available
          this.stats.active -= old.active

          this.connections.delete( sock.parent.instance )
          this.em.emit( "close", sock.parent )
        }
      } )

      var state = 0 /* waiting on header */
      var bodylength = 0
      var bodylengthread = 0
      var bodycache = new Buffer.from( [] )

      sock.on( "data", ( data ) => {

        if ( 2 == state ) {
          state = 0
          return
        }

        bodycache = Buffer.concat( [ bodycache, data ] )

        while ( bodycache.length > 0 ) {
          if ( 0 === state ) {
            let dataheader = bodycache.slice( 0, 5 )
            bodycache = bodycache.slice( 5 )

            if ( 0x33 == dataheader[ 0 ] ) {
              bodylength = ( dataheader[ 3 ] << 8 ) | dataheader[ 4 ]
              // We should do more checks here
              state = 1
            } else {
              console.error( "ProjectRTP Bad Magic" )
              state = 2
              return
            }
          }

          if ( bodycache.length > 0 ) {

            if ( bodycache.length < bodylength ) {
              return
            } else {
              state = 0
              let msgbody = bodycache.slice( 0, bodylength ).toString()
              // so that we simpy just don't index the old full buffer which grows and grows
              bodycache = new Buffer.from( bodycache.slice( bodylength ) )

              let msg = JSON.parse( msgbody )

              let old = this.connections.get( msg.instance )
              if ( undefined !== old ) {
                this.stats.available -= old.available
                this.stats.active -= old.active

                old.available = msg.status.channels.available
                old.active = msg.status.channels.active
              }

              this.stats.available += msg.status.channels.available
              this.stats.active += msg.status.channels.active

              if ( undefined !== msg.action && "connected" === msg.action ) {

                var srv = {
                  "sock": sock,
                  "instance": msg.instance,
                  "projectrtp": this,
                  "active": msg.status.channels.active,
                  "available": msg.status.channels.available
                }

                sock.parent = srv
                this.connections.set( msg.instance, srv )

                this.consolelog( `Client ${msg.instance} connected` )
                this.em.emit( "connection", srv )
              } else {
                let chann = this.channels.get( msg.id )
                if ( undefined !== chann ) {
                  chann.update( msg )
                }
              }

              this.consolelog( `${this.stats.available} total available channels and ${this.stats.active} total active channels across ${this.connections.size} instance(s)` )
            }
          }
        }
      } )
    } )

    this.server.on( "close", () => {
      this.consolelog( "Shutting down control server" )
    } )
  }

  consolelog( msg ) {
    if ( this.options.debug ) {
      console.log( msg )
    }
  }

  on( event, cb ) {
    this.em.on( event, cb )
  }

  send( srv, msg ) {

    let sock = srv.sock

    let encoded = JSON.stringify( msg )
    sock.write( Buffer.from( [ 0x33, 0x00, 0x00, ( encoded.length >> 8 ) & 0xff, encoded.length & 0xff ] ) )
    sock.write( encoded )
  }

  /*
    open a channel and get the port number to publish
    sdp is our received sdp as object - to obtain our target
  */
  channel( sdp, relatedchannel ) {
    /*
      Select an rtp instance during open.
      Notes, we could make this more efficient. How may servers will we have
      realistically. Up to a 100 - NP. Greater than that - perhaps we need to think
      about improving this. For future work we will also decide based on
      CPU reported by each server, but for now - how many channels are available.
      Always leave a spare channel so that a transfer can happen.
    */
    let srv

    if ( undefined !== relatedchannel ) {
      srv = relatedchannel.srv
    } else {
      for ( const [ key, value ] of this.connections.entries() ) {
        if ( undefined === srv || ( value.available > 2 && srv.active > value.active ) ) {
          srv = value
        }
      }
    }

    if ( undefined === srv ) {
      throw "Currently no connected projectrtp servers"
    }

    let channel = new projectrtpchannel( this, sdp, srv )
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
