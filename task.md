I am looking to develop a grafana backend based on this example. 

The backend shall connect to an HSDS server (https://github.com/HDFGroup/hsds), which is a cloud storage for HDF5 files. 

The h5web project implements the HSDS REST API, which can serve as a working example to read data from hsds (see hsds folder)

In the hsds-client-rs repo i have already developed an rust implementation of the hsds api (see src folder). This client has sofar be used to write data to hsds (upload of h5 files). We should extend this libary to support the reading of from hsds and use it the backend plugin. 

For the grafana frontend, we need to evaluate how to interact with our data, which follows a specific schema that groups hdf5 datasets into measurement channels and measurements into subsystems. Each hdf5 file (also called domain in hsds) represents a shot. Measurements and subsystems are hdf5 groups.
We would like to one or multiple measurements from one or multiple shots in grafana. Each measurement (1d, 2d, 3,d or RGB images) might have beween 1k to 1M samples, so performance is important. 