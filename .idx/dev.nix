{ pkgs, ... }: {
  # Use the latest stable channel
  channel = "stable-23.11";

  # Install Python (to run a simple web server)
  packages = [
    pkgs.python3
  ];

  # Configure the IDX Environment
  idx = {
    # Search for the "Live Preview" extension automatically
    extensions = [
      "ritwickdey.LiveServer"
    ];

    # Set up the Preview Window
    previews = {
      enable = true;
      previews = {
        web = {
          # This command starts the server on the right port
          command = ["python3" "-m" "http.server" "$PORT" "--bind" "0.0.0.0"];
          manager = "web";
        };
      };
    };
  };
}