import Testing
@testable import OpenClawDiscovery

struct WideAreaTXTQuotedStringTests {
    @Test func quotedTXTStringsPreserveEscapedQuotesAndSeparateFields() async throws {
        // DNS-SD character strings are separate attributes, including at the 255-byte limit.
        let fullLengthName = String(repeating: "x", count: 255 - "displayName=".utf8.count)
        let fixtures = [
            (#"Studio \"North\""#, "Studio \"North\""),
            (#"Studio\\"#, #"Studio\"#),
            (fullLengthName, fullLengthName),
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
                        "\"displayName=\(encoded)\" \"gatewayPort=18789\" \"cliPath=/opt/openclaw\""
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
            #expect(beacon.cliPath == "/opt/openclaw")
        }
    }
}
