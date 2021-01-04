# babble-projectrtp
Node module for [projectrtp the RTP server](https://github.com/tinpotnick/projectrtp). This, as well as projectrtp, is work in progress.

There is also a utility class for SDP manipulation which uses the sdp-transform library for parsing and generating.

# Interface

## Include and create an object to interface.

```javascript
const projectrtp = require( "babble-projectrtp" )
const rtp = new projectrtp()
```

This will start a server listening. RTP servers then can connect to us so that we can distribute work to them.

## Open a channel
A channel opens a stream between the ProjectRTP server and the UAC (or UAS).
```javascript
rtp.channel( remote )
  .then( ch => {
    // Do something this the channel. Perhaps display info about it.
    console.log( ch )
  } )
```

## Destroy a channel
```javascript
  ch.destroy()
    .then( () => { console.log( "Channel destroyed" ) })
```

## Functions
### Mix
Mix 1 + n channels together.

### Echo
A simple echo RTP back to other end.

```javascript
  ch.echo()
```

### Play (sound)
Play a sound 'soup' to the other end. See [projectrtp](https://github.com/tinpotnick/projectrtp) for more information.

```javascript
  ch.play( {
    "loop": true,
    "files": [
      { "wav": "ringing.wav", "loop": 6 },
      { "wav": "youare.wav" },
      { "wav": "first.wav" },
      { "wav": "inline.wav" }
    ]
  } )
```

# Example

Example with using drachtio. See separate instructions for starting an RTP server.

```javascript

const Srf = require( "drachtio-srf" )
const parseuri = require( "drachtio-srf" ).parseUri
const config = require( "config" )
const projectrtp = require( "babble-projectrtp" )

const srf = new Srf()
srf.connect( config.drachtio )


const rtp = new projectrtp()

srf.invite( ( req, res ) => {

  res.send( 180 )

  let parsedaor = parseuri( req.msg.uri )
  let remote = rtp.sdpgen( req.msg.body )

  // Grab a channel
  rtp.channel( remote )
    .then( ch => {

      let local = rtp.sdpgen()
                      .include( "pcmu pcma" )
                      .from( remote )
                      .setchannel( ch )

      const dlg = srf.createUAS( req, res, {
        localSdp: local.toString()
      } )

      .then( ( dlg ) => {

        switch( parsedaor.user ) {
          case "3":
            ch.play( { "loop": true, "files": [ { "wav": "uksounds.wav" } ] } )
            break
          default:
            ch.echo()
        }

        dlg.on( "destroy", () => {

          ch.destroy()
            .then( () => { console.log( "Channel destroyed" ) } )

          console.log( "Call ended" )
        } )
      } )
      .catch( ( err ) => {
        console.log( err )
      } )
  } )
} )


```

# TODO
* More intelligent routing to pass calls off to multiple RTP servers for scalability. It only currently supports single server.
* Mix more than 2 channels (conference).
* Support video (pass through)
* Lots!
