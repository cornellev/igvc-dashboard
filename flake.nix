{
  inputs = {
    nix-ros-overlay.url = "github:lopsided98/nix-ros-overlay/master";
    nixpkgs.follows = "nix-ros-overlay/nixpkgs";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      perSystem =
        { system, ... }:
        let
          pkgs = import inputs.nixpkgs {
            inherit system;
            overlays = [ inputs.nix-ros-overlay.overlays.default ];
          };
          ros = pkgs.rosPackages.humble;
        in
        {
          devShells.default = pkgs.mkShell {
            packages = [
              pkgs.bun
              pkgs.python3
              # pkgs.python3Packages.uvicorn
              # pkgs.python3Packages.websockets
              # pkgs.python3Packages.pyserial
              # pkgs.python3Packages.httpx
              # pkgs.python3Packages.rosbags
              # pkgs.python3Packages.opencv-python-headless
              # pkgs.python3Packages.numpy
              ros.rclpy
              ros.sensor-msgs
            ];
          };
        };
    };
}
