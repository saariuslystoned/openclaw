import Testing
@testable import OpenClawDiscovery

struct WideAreaTXTEscapeTests {
    @Test func txtEscapesNeverReinterpretEmittedBackslashes() async throws {
        let fixtures = [
            (#"Desk\\new"#, #"Desk\new"#),
            (#"Desk\\\\new"#, #"Desk\\new"#),
            (#"Desk\nnew"#, "Desk\nnew"),
            (#"Desk\qnew"#, #"Desk\qnew"#),
            (#"Desk\226\128\153s"#, "Desk’s"),
        ]
        for (encoded, expected) in fixtures {
            let context = WideAreaGatewayDiscovery.DiscoveryContext(
                tailscaleStatus: { #"{"Self":{"TailscaleIPs":["100.64.0.1"]}}"# },
                dig: { args, _ in
                    switch args.last ?? "" {
                    case "PTR":
                        "fixture._openclaw-gw._tcp.openclaw.internal."
                    case "SRV":
                        "0 0 18789 fixture.openclaw.internal."
                    case "TXT":
                        "\"displayName=\(encoded)\" \"gatewayPort=18789\""
                    default:
                        nil
                    }
                })
            let beacons = await TestIsolation.withEnvValues(
                ["OPENCLAW_WIDE_AREA_DOMAIN": "openclaw.internal"])
            {
                await WideAreaGatewayDiscovery.discover(timeoutSeconds: 2.0, context: context)
            }
            let beacon = try #require(beacons.first)
            #expect(beacons.count == 1)
            #expect(beacon.displayName == expected)
            #expect(beacon.gatewayPort == 18789)
        }
    }
}
